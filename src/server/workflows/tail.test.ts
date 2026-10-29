import { afterEach, describe, expect, it } from "vitest";
import { freshLog } from "./test-utils";
import { tailRun } from "./tail";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((d) => d())); });

/** A clock that only moves when the stream sleeps, so 20-minute behaviour runs in milliseconds. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } };
}

const lines = (text: string) => text.split("\n\n").filter(Boolean);

describe("SSE tail of a run's D1 log", () => {
  it("sends `: open` first, then every event with its seq as the SSE id, and ends when the run is done", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    await runLog.append("r1", "ws_a", { type: "run_started", runId: "r1", storeIds: ["a"] });
    await runLog.append("r1", "ws_a", { type: "store_done", storeId: "a", editionId: "ed_a" });
    await runLog.append("r1", "ws_a", { type: "run_done", runId: "r1", editionIds: ["ed_a"] });
    await runLog.finish("r1", "done");
    const body = await tailRun({ runLog, runId: "r1", now: c.now, sleep: c.sleep }).text();
    const frames = lines(body);
    expect(frames[0]).toBe(": open");
    expect(frames.slice(1).map((f) => f.split("\n")[0])).toEqual(["id: 1", "id: 2", "id: 3"]);
    expect(JSON.parse(frames[3].split("data: ")[1])).toMatchObject({ type: "run_done", editionIds: ["ed_a"] });
  });

  it("resumes after Last-Event-ID without repeating what the client already has", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    for (let i = 0; i < 4; i++) await runLog.append("r1", "ws_a", { type: "progress", runId: "r1", done: i, total: 4 });
    await runLog.finish("r1", "done");
    const body = await tailRun({ runLog, runId: "r1", afterSeq: 2, now: c.now, sleep: c.sleep }).text();
    expect(lines(body).slice(1).map((f) => f.split("\n")[0])).toEqual(["id: 3", "id: 4"]);
  });

  it("keeps a quiet run alive with a ping every 15 s and closes at its time limit", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    const body = await tailRun({ runLog, runId: "r1", now: c.now, sleep: c.sleep, pollMs: 5_000, heartbeatMs: 15_000, maxMs: 62_000 }).text();
    const pings = lines(body).filter((f) => f === ": ping").length;
    expect(pings).toBeGreaterThanOrEqual(3);
    expect(pings).toBeLessThanOrEqual(5);
  });

  it("picks up events written while it waits, and finishes once the run is done", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    let laps = 0;
    const sleep = async (ms: number) => {
      c.advance(ms);
      if (++laps === 2) await runLog.append("r1", "ws_a", { type: "store_started", storeId: "a" });
      if (laps === 3) { await runLog.append("r1", "ws_a", { type: "run_done", runId: "r1", editionIds: [] }); await runLog.finish("r1", "done"); }
    };
    const body = await tailRun({ runLog, runId: "r1", now: c.now, sleep }).text();
    expect(lines(body).filter((f) => f.startsWith("id:")).map((f) => f.split("\n")[0])).toEqual(["id: 1", "id: 2"]);
  });

  it("marks a run whose Workflow went silent for 20 minutes as stalled", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    c.advance(21 * 60_000);
    const body = await tailRun({ runLog, runId: "r1", now: c.now, sleep: c.sleep }).text();
    expect(body).toContain('"code":"run_stalled"');
    expect((await runLog.get("r1"))?.status).toBe("failed");
  });

  it("answers an unknown run with one error event, and stops when the client aborts", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    expect(await tailRun({ runLog, runId: "nope", now: c.now, sleep: c.sleep }).text()).toContain('"code":"run_not_found"');
    await runLog.start("r2", "ws_a", 1);
    const abort = new AbortController();
    const res = tailRun({ runLog, runId: "r2", signal: abort.signal, now: Date.now });
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": open\n\n");
    abort.abort();
    let result = await reader.read();
    while (!result.done) result = await reader.read();
    expect(result.done).toBe(true);
  });
});
