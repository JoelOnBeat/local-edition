import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildEditions } from "@/server/agent/build";
import { harness, WEEK_OF, type Harness } from "@/server/agent/test-utils";
import { POST } from "@/app/api/editions/build/route";
import { setRepo } from "../store";
import { setPlatformEnv, type PlatformEnv } from "../platform/env";
import { FakeStep, freshLog, params, runEditionBuild } from "./test-utils";
import { useWorkflow } from "./mode";
import { RunLog } from "./run-log";
import type { BuildWorkflowInput } from "./types";

/** The production path of POST /api/editions/build: start a Workflow, tail its D1 events. Workflows are faked; D1 is real SQLite. */

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((d) => d()));
  setPlatformEnv(undefined);
  delete process.env.BUILD_MODE;
});

async function platform(simulate: (runLog: RunLog, p: BuildWorkflowInput) => Promise<void> | void) {
  const log = await freshLog();
  disposers.push(log.dispose);
  const created: BuildWorkflowInput[] = [];
  const env = {
    LE_DB: log.db,
    EDITION_BUILD: {
      get: async () => { throw new Error("unused"); },
      create: async ({ id, params: p }: { id?: string; params: BuildWorkflowInput }) => {
        created.push(p);
        void Promise.resolve(simulate(log.runLog, p));
        return { id: id ?? "", status: async () => ({ status: "running" }) };
      },
    },
  } as unknown as PlatformEnv;
  setPlatformEnv(env);
  process.env.BUILD_MODE = "workflow";
  return { ...log, created };
}

const post = (body: unknown = {}, headers: Record<string, string> = {}, signal?: AbortSignal) =>
  POST(new Request("http://localhost/api/editions/build", { method: "POST", body: JSON.stringify(body), signal, headers: { "content-type": "application/json", "cf-connecting-ip": "10.9.9.9", ...headers } }));
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const frames = (text: string) => text.split("\n\n").filter(Boolean);

const finishRun = async (runLog: RunLog, p: BuildWorkflowInput) => {
  await runLog.append(p.runId, p.workspaceId, { type: "run_started", runId: p.runId, storeIds: ["s"] });
  await runLog.append(p.runId, p.workspaceId, { type: "run_done", runId: p.runId, editionIds: [] });
  await runLog.finish(p.runId, "done");
};

describe("POST /api/editions/build with the Workflow bound", () => {
  it("starts the EditionBuild Workflow with the workspace and stores, and streams the run from D1", async () => {
    const { created } = await platform(finishRun);
    const res = await post({ force: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const out = frames(await res.text());
    expect(out[0]).toBe(": open");
    expect(out.slice(1).map((f) => f.split("\n")[0])).toEqual(["id: 1", "id: 2"]);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ force: true, trigger: "request" });
    expect(created[0].runId).toMatch(/^run_/);
    expect(created[0].workspaceId).toMatch(/^ws_/);
  });

  it("answers 409 build_running while a run is live, and re-attaches (no second run) with Last-Event-ID", async () => {
    const { created, runLog } = await platform(async (rl, p) => {
      await rl.append(p.runId, p.workspaceId, { type: "run_started", runId: p.runId, storeIds: ["s"] });
      await rl.append(p.runId, p.workspaceId, { type: "progress", runId: p.runId, done: 1, total: 1 });
    });
    const abort = new AbortController();
    const first = await post({}, {}, abort.signal);
    const cookie = cookieOf(first);
    abort.abort();
    const second = await post({}, { cookie });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "build_running" });

    const runId = created[0].runId;
    await runLog.append(runId, created[0].workspaceId, { type: "run_done", runId, editionIds: [] });
    await runLog.finish(runId, "done");
    const resumed = await post({}, { cookie, "last-event-id": "2" });
    expect(resumed.status).toBe(200);
    const out = frames(await resumed.text());
    expect(out.slice(1).map((f) => f.split("\n")[0])).toEqual(["id: 3"]);
    expect(created).toHaveLength(1);
  });

  it("validates before starting anything: unknown store 404 and a bad body 400", async () => {
    const { created } = await platform(finishRun);
    const first = await post({});
    const cookie = cookieOf(first);
    await first.body?.cancel();
    const unknown = await post({ storeIds: ["store_nope"] }, { cookie });
    expect(unknown.status).toBe(404);
    expect((await post({ storeIds: "x" }, { cookie })).status).toBe(400);
    expect(created).toHaveLength(1);
  });

  it("runs inline, not through the Workflow, when nothing is bound or BUILD_MODE=inline", async () => {
    await platform(finishRun);
    expect(useWorkflow()).toBe(true);
    process.env.BUILD_MODE = "inline";
    expect(useWorkflow()).toBe(false);
    process.env.BUILD_MODE = "workflow";
    setPlatformEnv({ LE_DB: undefined } as unknown as PlatformEnv);
    expect(useWorkflow()).toBe(false);
    setPlatformEnv(null);
    delete process.env.BUILD_MODE;
    expect(useWorkflow()).toBe(false);
  });

  it("reports workflow_unavailable (503) and frees the workspace when the Workflow cannot start", async () => {
    const log = await freshLog();
    disposers.push(log.dispose);
    setPlatformEnv({ LE_DB: log.db, EDITION_BUILD: { create: async () => { throw new Error("quota"); }, get: async () => { throw new Error("x"); } } } as unknown as PlatformEnv);
    process.env.BUILD_MODE = "workflow";
    const res = await post({});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "workflow_unavailable" });
    const retry = await post({}, { cookie: cookieOf(res) });
    expect(retry.status).toBe(503); // not 409: the failed run no longer counts as live
  });
});

describe("EditionBuild over the real per-store build", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness({ storeCount: 3 });
    setRepo(h.repo);
  });
  afterEach(() => setRepo(undefined));

  it("builds each store through buildEditions, one step per store, and persists editions and a clean event log", async () => {
    const log = await freshLog();
    disposers.push(log.dispose);
    await log.runLog.start("run_t1", h.workspaceId, h.storeIds.length);
    const step = new FakeStep();
    const out = await runEditionBuild(step, {
      runLog: log.runLog,
      planStores: async (p) => p.storeIds ?? h.storeIds,
      buildStore: (storeId, p) => buildEditions({ workspaceId: p.workspaceId, storeIds: [storeId], weekOf: WEEK_OF, runId: p.runId }, h.deps),
    }, params({ workspaceId: h.workspaceId }));

    expect(out.status).toBe("done");
    expect(out.editionIds).toHaveLength(3);
    expect(step.order.filter((n) => n.startsWith("store:"))).toEqual(h.storeIds.map((id) => `store:${id}`));
    for (const storeId of h.storeIds) expect((await h.repo.getEditionForWeek(storeId, WEEK_OF))?.items.length).toBeGreaterThan(0);
    const events = (await log.runLog.readFrom("run_t1", 0)).map((e) => e.event);
    expect(events.filter((e) => e.type === "run_started")).toHaveLength(1);
    expect(events.filter((e) => e.type === "run_done")).toHaveLength(1);
    expect(events.filter((e) => e.type === "store_done")).toHaveLength(3);
    expect(events.filter((e) => e.type === "item_drafted").length).toBeGreaterThanOrEqual(9);
    expect(events.at(-1)).toMatchObject({ type: "run_done", runId: "run_t1" });
    // The build's own lock was released after every store.
    expect(await h.repo.acquireLock(`build:${h.workspaceId}`, 5)).toBeTruthy();
  });
});
