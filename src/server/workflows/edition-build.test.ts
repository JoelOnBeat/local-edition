import { afterEach, describe, expect, it } from "vitest";
import { CrashError, FakeStep, freshLog, okStore, params, runEditionBuild, scriptedPorts, types, type StoreScript } from "./test-utils";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((d) => d())); });
const setup2 = async () => {
  const log = await freshLog();
  disposers.push(log.dispose);
  expect(await log.runLog.start("run_t2", "ws_t", 1)).toBe(true);
  return log.runLog;
};
const setup = async () => {
  const log = await freshLog();
  disposers.push(log.dispose);
  expect(await log.runLog.start("run_t1", "ws_t", 3)).toBe(true);
  return log.runLog;
};

describe("EditionBuild step logic", () => {
  it("builds one store per step, drops the per-store run wrappers, and writes progress and one run_done", async () => {
    const runLog = await setup();
    const calls: string[] = [];
    const step = new FakeStep();
    const out = await runEditionBuild(step, scriptedPorts(runLog, ["a", "b", "c"], okStore, calls), params());
    expect(out).toMatchObject({ status: "done", editionIds: ["ed_a", "ed_b", "ed_c"], failedStoreIds: [] });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(step.order.filter((n) => n.startsWith("store:"))).toEqual(["store:a", "store:b", "store:c"]);
    expect(await types(runLog)).toEqual([
      "run_started", "store_started", "store_done", "progress", "store_started", "store_done", "progress", "store_started", "store_done", "progress", "run_done",
    ]);
    const progress = (await runLog.readFrom("run_t1", 0)).flatMap((e) => (e.event.type === "progress" ? [e.event] : []));
    expect(progress.map((p) => [p.done, p.total])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(await runLog.get("run_t1")).toMatchObject({ status: "done", done: 3 });
  });

  it("prefetches the week's events in its own retried step before the first store, and a failed prefetch never fails the run", async () => {
    const runLog = await setup();
    const step = new FakeStep();
    const seen: string[][] = [];
    const ports = { ...scriptedPorts(runLog, ["a", "b"], okStore), prefetchEvents: async (_p: unknown, ids: string[]) => { seen.push(ids); } };
    const out = await runEditionBuild(step, ports, params());
    expect(out.status).toBe("done");
    expect(seen).toEqual([["a", "b"]]);
    expect(step.order.indexOf("prefetch-events")).toBeGreaterThan(step.order.indexOf("plan"));
    expect(step.order.indexOf("prefetch-events")).toBeLessThan(step.order.indexOf("store:a"));

    const runLog2 = await setup2();
    let tries = 0;
    const flaky = { ...scriptedPorts(runLog2, ["a"], okStore), prefetchEvents: async () => { tries++; throw new Error("tavily slow"); } };
    const step2 = new FakeStep();
    const out2 = await runEditionBuild(step2, flaky, params({ runId: "run_t2" }));
    expect(tries).toBe(3); // one try and two retries
    expect(out2).toMatchObject({ status: "done", editionIds: ["ed_a"] });
  });

  it("retries a store that failed outright, and never shows the failed first attempt", async () => {
    const runLog = await setup();
    const script: StoreScript = (id, attempt) =>
      id === "b" && attempt === 1 ? [{ type: "error", storeId: "b", code: "store_failed", message: "x" }] : okStore(id, attempt);
    const step = new FakeStep();
    const out = await runEditionBuild(step, scriptedPorts(runLog, ["a", "b", "c"], script), params());
    expect(step.attempts.get("store:b")).toBe(2);
    expect(out.editionIds).toEqual(["ed_a", "ed_b", "ed_c"]);
    expect((await runLog.readFrom("run_t1", 0)).some((e) => e.event.type === "error")).toBe(false);
  });

  it("reports a store whose retries are spent as store_failed and carries on with the next one", async () => {
    const runLog = await setup();
    const script: StoreScript = (id) => (id === "b" ? [{ type: "error", storeId: "b", code: "store_failed", message: "x" }] : okStore(id, 1));
    const out = await runEditionBuild(new FakeStep(), scriptedPorts(runLog, ["a", "b", "c"], script), params());
    expect(out).toMatchObject({ status: "done", editionIds: ["ed_a", "ed_c"], failedStoreIds: ["b"] });
    const errors = (await runLog.readFrom("run_t1", 0)).flatMap((e) => (e.event.type === "error" ? [e.event] : []));
    expect(errors).toEqual([{ type: "error", storeId: "b", code: "store_failed", message: "Could not finish the edition for this store." }]);
  });

  it("keeps non-fatal notices (has_approvals) in the stream without retrying", async () => {
    const runLog = await setup();
    const script: StoreScript = (id) => (id === "a" ? [{ type: "error", storeId: "a", code: "has_approvals", message: "kept" }] : okStore(id, 1));
    const step = new FakeStep();
    const out = await runEditionBuild(step, scriptedPorts(runLog, ["a", "b"], script), params());
    expect(step.attempts.get("store:a")).toBe(1);
    expect(out.editionIds).toEqual(["ed_b"]);
    expect((await types(runLog)).filter((t) => t === "error")).toHaveLength(1);
  });

  it("stops at the spend cap: later stores are not built, the run fails, and there is no run_done", async () => {
    const runLog = await setup();
    const calls: string[] = [];
    const script: StoreScript = (id) => (id === "b" ? [{ type: "error", storeId: "b", code: "spend_cap", message: "cap" }] : okStore(id, 1));
    const out = await runEditionBuild(new FakeStep(), scriptedPorts(runLog, ["a", "b", "c"], script, calls), params());
    expect(calls).toEqual(["a", "b"]);
    expect(out).toMatchObject({ status: "failed", spendCap: true, editionIds: ["ed_a"] });
    expect(await types(runLog)).not.toContain("run_done");
    expect((await runLog.get("run_t1"))?.status).toBe("failed");
  });

  it("fails cleanly when the workspace or a requested store does not exist", async () => {
    const runLog = await setup();
    const out = await runEditionBuild(new FakeStep(), scriptedPorts(runLog, ["a"], okStore), params({ workspaceId: "ws_missing" }));
    expect(out.status).toBe("failed");
    expect(await types(runLog)).toEqual(["error"]);
    expect((await runLog.get("run_t1"))?.status).toBe("failed");
  });

  it("resumes after the engine dies mid-run: finished steps are not repeated and the log has no duplicates", async () => {
    const runLog = await setup();
    const calls: string[] = [];
    const ports = scriptedPorts(runLog, ["a", "b", "c"], okStore, calls);
    const step = new FakeStep();
    step.crashAfter = 4; // plan, store:a, progress:0, store:b finished; the engine dies before progress:1
    await expect(runEditionBuild(step, ports, params())).rejects.toBeInstanceOf(CrashError);
    step.crashAfter = null;
    const out = await runEditionBuild(step, ports, params());
    expect(out.editionIds).toEqual(["ed_a", "ed_b", "ed_c"]);
    expect(calls).toEqual(["a", "b", "c"]);
    const kinds = await types(runLog);
    expect(kinds.filter((t) => t === "run_started")).toHaveLength(1);
    expect(kinds.filter((t) => t === "store_done")).toHaveLength(3);
    expect(kinds.filter((t) => t === "run_done")).toHaveLength(1);
  });
});

describe("RunLog", () => {
  it("allows one live run per workspace, lets a stale one be replaced, and keeps workspaces apart", async () => {
    let t = 1_000_000;
    const log = await freshLog(() => t);
    disposers.push(log.dispose);
    expect(await log.runLog.start("r1", "ws_a", 2)).toBe(true);
    expect(await log.runLog.start("r2", "ws_a", 2)).toBe(false);
    expect(await log.runLog.start("r3", "ws_b", 2)).toBe(true);
    t += 21 * 60_000;
    expect(await log.runLog.start("r4", "ws_a", 2)).toBe(true);
    await log.runLog.finish("r4", "done");
    expect(await log.runLog.start("r5", "ws_a", 2)).toBe(true);
  });

  it("assigns increasing seq numbers under concurrent appends and ignores rows that no longer parse", async () => {
    const log = await freshLog();
    disposers.push(log.dispose);
    await log.runLog.start("r1", "ws_a", 1);
    await Promise.all(Array.from({ length: 10 }, (_, i) => log.runLog.append("r1", "ws_a", { type: "progress", runId: "r1", done: i, total: 10 })));
    await log.db.prepare("INSERT INTO build_events (run_id, seq, workspace_id, json, created_at) VALUES ('r1', 99, 'ws_a', '{nope', 0)").run();
    const rows = await log.runLog.readFrom("r1", 0);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await log.runLog.readFrom("r1", 8)).map((r) => r.seq)).toEqual([9, 10]);
  });
});

describe("EditionBuild: head-office digest", () => {
  it("posts the digest in its own step after run_done, with the finished edition ids; a failing digest never fails the build", async () => {
    const runLog = await setup();
    const seen: string[][] = [];
    const ports = { ...scriptedPorts(runLog, ["a", "b"], okStore), afterBuild: async (_p: unknown, ids: string[]) => { seen.push(ids); } };
    const step = new FakeStep();
    const out = await runEditionBuild(step, ports, params());
    expect(out.status).toBe("done");
    expect(seen).toEqual([["ed_a", "ed_b"]]);
    expect(step.order.indexOf("digest")).toBeGreaterThan(step.order.indexOf("finish"));
    expect((await types(runLog)).at(-1)).toBe("run_done");

    const runLog2 = await setup2();
    const broken = { ...scriptedPorts(runLog2, ["a"], okStore), afterBuild: async () => { throw new Error("slack down"); } };
    const out2 = await runEditionBuild(new FakeStep(), broken, params({ runId: "run_t2" }));
    expect(out2).toMatchObject({ status: "done", editionIds: ["ed_a"] });
    expect(await runLog2.get("run_t2")).toMatchObject({ status: "done" });
  });

  it("does not post a digest for a run that hit the spend cap or built nothing", async () => {
    const runLog = await setup();
    let called = 0;
    const script: StoreScript = (id) => [{ type: "error", storeId: id, code: "spend_cap", message: "cap" }];
    const ports = { ...scriptedPorts(runLog, ["a"], script), afterBuild: async () => { called++; } };
    const out = await runEditionBuild(new FakeStep(), ports, params());
    expect(out.status).toBe("failed");
    expect(called).toBe(0);
  });
});
