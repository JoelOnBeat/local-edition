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

describe("L3: tail cost control", () => {
  it("waits 1.5 s at first and backs off to 5 s on quiet laps", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); c.advance(ms); };
    await tailRun({ runLog, runId: "r1", now: c.now, sleep, maxMs: 40_000 }).text();
    expect(waits.slice(0, 5)).toEqual([1500, 2250, 3375, 5000, 5000]);
    expect(Math.max(...waits)).toBe(5000);
  });

  it("spends one D1 query on a lap that found events, and reads the run status only on a quiet one", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    for (let i = 0; i < 3; i++) await runLog.append("r1", "ws_a", { type: "progress", runId: "r1", done: i, total: 3 });
    await runLog.finish("r1", "done");
    let reads = 0;
    let gets = 0;
    const spy = Object.create(runLog) as typeof runLog;
    spy.readFrom = async (...a) => { reads++; return runLog.readFrom(...a); };
    spy.get = async (...a) => { gets++; return runLog.get(...a); };
    await tailRun({ runLog: spy, runId: "r1", now: c.now, sleep: c.sleep }).text();
    expect(reads).toBe(3); // the events; a quiet read; then one more read after the run is seen finished (the drain)
    expect(gets).toBe(1); // the status is read only on the quiet lap
  });

  it("stays under the 1,000-query invocation limit over a full 20 minutes of a quiet run, ending gracefully when it must", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    let queries = 0;
    const spy = Object.create(runLog) as typeof runLog;
    spy.readFrom = async (...a) => { queries++; return runLog.readFrom(...a); };
    spy.get = async (...a) => { queries++; await runLog.append("r1", "ws_a", { type: "progress", runId: "r1", done: 0, total: 1 }).catch(() => undefined); return runLog.get(...a); };
    const body = await tailRun({ runLog: spy, runId: "r1", now: c.now, sleep: c.sleep }).text();
    expect(queries).toBeLessThanOrEqual(900);
    expect(body).not.toContain("stream_failed");
    // a tiny budget ends the stream by itself, not with an error
    queries = 0;
    const small = await tailRun({ runLog: spy, runId: "r1", now: c.now, sleep: c.sleep, maxQueries: 6, afterSeq: 10_000 }).text();
    expect(queries).toBeLessThanOrEqual(7);
    expect(small).not.toContain('"type":"error"');
  });

  it("calls onClose exactly once, when the run ends, when the client aborts and when the stream is cancelled", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    await runLog.finish("r1", "done");
    let closes = 0;
    await tailRun({ runLog, runId: "r1", now: c.now, sleep: c.sleep, onClose: () => { closes++; } }).text();
    expect(closes).toBe(1);
    await runLog.start("r2", "ws_a", 1);
    const abort = new AbortController();
    const res = tailRun({ runLog, runId: "r2", signal: abort.signal, onClose: () => { closes++; } });
    const reader = res.body!.getReader();
    await reader.read();
    abort.abort();
    let r = await reader.read();
    while (!r.done) r = await reader.read();
    expect(closes).toBe(2);
    const res2 = tailRun({ runLog, runId: "r2", onClose: () => { closes++; } });
    await res2.body!.cancel();
    expect(closes).toBe(3);
  });
  it("finishes onClose BEFORE the response body ends (Workers may cancel work still pending once the response is complete)", async () => {
    const c = clock();
    const { runLog, dispose } = await freshLog(c.now);
    disposers.push(dispose);
    await runLog.start("r1", "ws_a", 1);
    await runLog.finish("r1", "done");
    let released = false;
    const onClose = async () => { await new Promise((r) => setTimeout(r, 20)); released = true; };
    const res = tailRun({ runLog, runId: "r1", now: c.now, sleep: c.sleep, onClose });
    const reader = res.body!.getReader();
    let r = await reader.read();
    while (!r.done) r = await reader.read();
    expect(released).toBe(true);
  });
});
