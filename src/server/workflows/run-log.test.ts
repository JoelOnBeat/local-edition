import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "@/contract";
import type { D1Like } from "../platform/types";
import { RunLog } from "./run-log";
import { FakeStep, freshLog, okStore, params, runEditionBuild, scriptedPorts, type StoreScript } from "./test-utils";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((d) => d())); });
const fresh = async (now?: () => number) => {
  const log = await freshLog(now);
  disposers.push(log.dispose);
  return log;
};
const drafted = (n: number): AgentEvent => ({ type: "progress", runId: "r1", done: n, total: 9 });
const dones = async (runLog: RunLog, afterSeq = 0) => (await runLog.readFrom("r1", afterSeq)).map((e) => (e.event as { done: number }).done);

describe("L1: RunLog.start is idempotent for the run's own id", () => {
  it("succeeds again for a run that is still running, and does not let a different id in", async () => {
    const { runLog } = await fresh();
    expect(await runLog.start("r1", "ws_a", 4)).toBe(true);
    expect(await runLog.start("r1", "ws_a", 4)).toBe(true);
    expect(await runLog.start("r2", "ws_a", 4)).toBe(false);
  });

  it("never revives a run that finished, or takes over another workspace's run id", async () => {
    const { runLog } = await fresh();
    await runLog.start("r1", "ws_a", 4);
    expect(await runLog.start("r1", "ws_b", 4)).toBe(false);
    await runLog.finish("r1", "failed");
    expect(await runLog.start("r1", "ws_a", 4)).toBe(false);
    expect((await runLog.get("r1"))?.status).toBe("failed");
  });

  it("refreshes the run's liveness stamp when it starts again", async () => {
    let t = 1_000_000;
    const { runLog } = await fresh(() => t);
    await runLog.start("r1", "ws_a", 4);
    t += 5 * 60_000;
    await runLog.start("r1", "ws_a", 4);
    expect((await runLog.get("r1"))?.updatedAt).toBe(t);
  });
});

describe("L2: events carry the step attempt, and a retry replaces the earlier attempt's events", () => {
  it("replays only the latest attempt of a store, and keeps seq growing so a live client misses nothing", async () => {
    const { runLog } = await fresh();
    await runLog.start("r1", "ws_a", 1);
    await runLog.append("r1", "ws_a", drafted(1), { scope: "s1", attempt: 1 });
    await runLog.append("r1", "ws_a", drafted(2), { scope: "s1", attempt: 1 });
    const seen = (await runLog.readFrom("r1", 0)).at(-1)!.seq; // a live viewer has read both
    await runLog.supersedeBefore("r1", { scope: "s1", attempt: 2 });
    await runLog.append("r1", "ws_a", drafted(3), { scope: "s1", attempt: 2 });
    expect(await dones(runLog)).toEqual([3]);
    const next = await runLog.readFrom("r1", seen);
    expect(next.map((e) => e.seq)).toEqual([3]); // strictly after what the viewer saw, not recycled
  });

  it("supersedes lazily too: the first write of attempt 2 retires attempt 1 even without supersedeBefore", async () => {
    const { runLog } = await fresh();
    await runLog.start("r1", "ws_a", 1);
    await runLog.append("r1", "ws_a", drafted(1), { scope: "s1", attempt: 1 });
    await runLog.append("r1", "ws_a", drafted(2), { scope: "s1", attempt: 2 });
    expect(await dones(runLog)).toEqual([2]);
  });

  it("drops a write from an attempt that a later one has overtaken (a timed-out attempt still running)", async () => {
    const { runLog } = await fresh();
    await runLog.start("r1", "ws_a", 1);
    await runLog.append("r1", "ws_a", drafted(2), { scope: "s1", attempt: 2 });
    await runLog.append("r1", "ws_a", drafted(1), { scope: "s1", attempt: 1 }); // the zombie
    expect(await dones(runLog)).toEqual([2]);
  });

  it("keeps other stores, and events with no attempt, untouched", async () => {
    const { runLog } = await fresh();
    await runLog.start("r1", "ws_a", 2);
    await runLog.append("r1", "ws_a", drafted(0));
    await runLog.append("r1", "ws_a", drafted(1), { scope: "s1", attempt: 1 });
    await runLog.append("r1", "ws_a", drafted(2), { scope: "s2", attempt: 1 });
    await runLog.append("r1", "ws_a", drafted(3), { scope: "s1", attempt: 2 });
    expect(await dones(runLog)).toEqual([0, 2, 3]);
  });

  it("takes the next seq when two writers race for the same one", async () => {
    const { db, runLog } = await fresh();
    await runLog.start("r1", "ws_a", 1);
    let thrown = false;
    const flaky: D1Like = {
      prepare: (q) => db.prepare(q),
      batch: async (b) => {
        if (!thrown) { thrown = true; throw new Error("UNIQUE constraint failed: build_events.run_id, build_events.seq"); }
        return db.batch(b);
      },
    };
    await new RunLog(flaky).append("r1", "ws_a", drafted(1));
    expect(thrown).toBe(true);
    expect(await dones(runLog)).toEqual([1]);
  });

  it("many concurrent appends from two attempts of one store never collide on seq", async () => {
    const { runLog } = await fresh();
    await runLog.start("r1", "ws_a", 1);
    await Promise.all(Array.from({ length: 20 }, (_, i) => runLog.append("r1", "ws_a", drafted(i), { scope: "s1", attempt: i % 2 === 0 ? 1 : 2 })));
    const seqs = (await runLog.readFrom("r1", 0, 500)).map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe("L2: through the EditionBuild step logic", () => {
  it("a store whose first attempt wrote events and then failed shows its events once", async () => {
    const { runLog } = await fresh();
    await runLog.start("run_t1", "ws_t", 2);
    const script: StoreScript = (id, attempt) =>
      id === "b" && attempt === 1
        ? [{ type: "store_started", storeId: "b" }, { type: "tool_call", storeId: "b", tool: "qloo", args: {} }, { type: "error", storeId: "b", code: "store_failed", message: "x" }]
        : okStore(id, attempt);
    const step = new FakeStep();
    const out = await runEditionBuild(step, scriptedPorts(runLog, ["a", "b"], script), params());
    expect(step.attempts.get("store:b")).toBe(2);
    expect(out.editionIds).toEqual(["ed_a", "ed_b"]);
    const kinds = (await runLog.readFrom("run_t1", 0)).filter((e) => (e.event as { storeId?: string }).storeId === "b").map((e) => e.event.type);
    expect(kinds).toEqual(["store_started", "store_done"]);
  });

  it("when the first attempt's events were already written, the retry's replace them", async () => {
    const { runLog } = await fresh();
    await runLog.start("run_t1", "ws_t", 1);
    let attempt = 0;
    const base = scriptedPorts(runLog, ["a"], okStore);
    const ports = {
      ...base,
      async *buildStore(storeId: string, p: Parameters<typeof base.buildStore>[1]) {
        attempt++;
        yield { type: "store_started", storeId } as AgentEvent;
        if (attempt === 1) throw new Error("the isolate was killed mid-store");
        yield { type: "store_done", storeId, editionId: "ed_a" } as AgentEvent;
        void p;
      },
    };
    await runEditionBuild(new FakeStep(), ports, params());
    const kinds = (await runLog.readFrom("run_t1", 0)).map((e) => e.event.type);
    expect(kinds.filter((k) => k === "store_started")).toHaveLength(1);
    expect(kinds).toContain("store_done");
  });
});
