import { afterEach, describe, expect, it } from "vitest";
import { AgentEvent } from "@/contract";
import { buildEditions } from "../agent/build";
import { AGENT_MODEL, type ChatClient } from "../agent/ports";
import { WEEK_OF, harness } from "../agent/test-utils";
import { UpstreamError } from "../http/errors";
import { deriveRun } from "@/components/runs/run-model";
import { FakeStep, freshLog, okStore, params, runEditionBuild, scriptedPorts, types, type StoreScript } from "./test-utils";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((d) => d())); });
const setup = async (total = 3) => {
  const log = await freshLog();
  disposers.push(log.dispose);
  expect(await log.runLog.start("run_t1", "ws_t", total)).toBe(true);
  return log.runLog;
};

const NOTE = "Nemotron 3.5 Super VL is unavailable on Token Factory right now; this store will build on the next run.";
const skip = (storeId: string): AgentEvent => ({ type: "error", storeId, code: "model_unavailable", message: NOTE });

describe("EditionBuild: a store skipped for an unavailable model", () => {
  it("ends that store as skipped, builds the others, finishes done_with_skips and never retries the skipped one", async () => {
    const runLog = await setup();
    const script: StoreScript = (id) => (id === "b" ? [{ type: "store_started", storeId: "b" }, skip("b")] : okStore(id, 1));
    const step = new FakeStep();
    const out = await runEditionBuild(step, scriptedPorts(runLog, ["a", "b", "c"], script), params());

    expect(out).toMatchObject({ status: "done_with_skips", editionIds: ["ed_a", "ed_c"], failedStoreIds: [], skippedStoreIds: ["b"], spendCap: false });
    expect(step.attempts.get("store:b")).toBe(1); // a retry would hit the same 404
    expect(await runLog.get("run_t1")).toMatchObject({ status: "done_with_skips", done: 3 });

    const kinds = await types(runLog);
    expect(kinds.at(-1)).toBe("run_done"); // the run still ends normally, with the editions that did build
    const events = (await runLog.readFrom("run_t1", 0)).map((e) => e.event);
    expect(events.filter((e) => e.type === "error")).toEqual([skip("b")]); // one run event, with the plain note, no store_failed
    const progress = events.flatMap((e) => (e.type === "progress" ? [[e.done, e.total]] : []));
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);

    // The run view reads it: b is skipped (amber), a and c are drafted, nothing is failed.
    const lanes = Object.fromEntries(deriveRun(events).lanes.map((l) => [l.storeId, l]));
    expect(lanes.a.status).toBe("done");
    expect(lanes.b).toMatchObject({ status: "skipped", skipKind: "model", skipReason: NOTE });
    expect(lanes.c.status).toBe("done");
  });

  it("a run where every store is skipped finishes done_with_skips with no digest; a mixed run posts the digest for the editions that built", async () => {
    const posted: string[][] = [];
    const afterBuild = async (_p: unknown, ids: string[]) => { posted.push(ids); };

    const allSkipped = await setup(2);
    const none = await runEditionBuild(new FakeStep(), { ...scriptedPorts(allSkipped, ["a", "b"], (id) => [skip(id)]), afterBuild }, params());
    expect(none).toMatchObject({ status: "done_with_skips", editionIds: [], skippedStoreIds: ["a", "b"] });
    expect(posted).toEqual([]);

    const mixed = await setup();
    const some = await runEditionBuild(new FakeStep(), { ...scriptedPorts(mixed, ["a", "b", "c"], (id) => (id === "b" ? [skip("b")] : okStore(id, 1))), afterBuild }, params());
    expect(some.status).toBe("done_with_skips");
    expect(posted).toEqual([["ed_a", "ed_c"]]);
  });

  it("a real mixed run: Super VL is gone for the first store only; the second builds from the real agent", async () => {
    const h = await harness({ storeCount: 2 });
    const [first, second] = h.storeIds;
    const firstName = (await h.repo.getStore(first))!.name;
    const chat: ChatClient = {
      complete: (req) => (req.model === AGENT_MODEL && JSON.stringify(req.messages).includes(firstName)
        ? Promise.reject(new UpstreamError("upstream_4xx", "tokenfactory", "tokenfactory rejected the request (HTTP 404).", { status: 404 }))
        : h.chat.complete(req)),
    };
    const deps = { ...h.deps, chat };
    const runLog = await setup(2);
    const ports = {
      runLog,
      planStores: async () => h.storeIds,
      buildStore: (id: string, p: { runId: string; workspaceId: string }) => buildEditions({ workspaceId: p.workspaceId, storeIds: [id], weekOf: WEEK_OF, runId: p.runId, skipPrefetch: true }, deps),
    };
    const step = new FakeStep();
    const out = await runEditionBuild(step, ports, params({ workspaceId: h.workspaceId }));

    expect(out.status).toBe("done_with_skips");
    expect(out.skippedStoreIds).toEqual([first]);
    expect(out.failedStoreIds).toEqual([]);
    expect(out.editionIds).toHaveLength(1);
    expect(step.attempts.get(`store:${first}`)).toBe(1);
    expect(await h.repo.getEditionForWeek(first, WEEK_OF)).toBeNull();
    expect((await h.repo.getEditionForWeek(second, WEEK_OF))?.items.length).toBe(4);
    const events = (await runLog.readFrom("run_t1", 0)).map((e) => e.event);
    expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", storeId: first, code: "model_unavailable", message: NOTE }]);
    expect(events.at(-1)).toMatchObject({ type: "run_done", editionIds: out.editionIds });
  });
});
