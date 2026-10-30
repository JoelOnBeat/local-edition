import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MemoryRecorder } from "@/server/http/recorder";
import { QlooClient } from "@/server/qloo/client";
import { memoryCache } from "@/server/qloo/deps";
import { QLOO_DAILY_SLICE, QLOO_TOTAL_CAP, createQlooLedger, qlooCallsUsed } from "@/server/qloo/ledger";
import { fakeBudgetStub, noSleep, ok, testGate } from "./helpers";

const PLACES = { success: true, results: { entities: [] } };
const liveClient = (fetchImpl: unknown, gate: ReturnType<typeof testGate> | null, over: { cacheOnly?: boolean; retries?: number } = {}) =>
  new QlooClient({
    mode: "live", status: "live", apiKey: "qk_test_SECRET", fetchImpl: fetchImpl as never, sleep: noSleep, recorder: new MemoryRecorder(),
    gate: async () => gate, ...over,
  });

describe("the hard Qloo call ledger", () => {
  it("caps the whole app at 300 calls through 15 Dec and 40 a day", () => {
    expect(QLOO_TOTAL_CAP).toBe(300);
    expect(QLOO_DAILY_SLICE).toBe(40);
  });

  it("refuses the call that would pass the daily slice, before any request goes out", async () => {
    const gate = testGate({ totalCap: 300, dailyCap: 2 });
    const fetchImpl = vi.fn(async () => ok(PLACES));
    const client = liveClient(fetchImpl, gate);
    await client.insights({ "filter.type": "urn:entity:place", take: 1 });
    await client.insights({ "filter.type": "urn:entity:place", take: 2 });
    await expect(client.insights({ "filter.type": "urn:entity:place", take: 3 })).rejects.toMatchObject({ code: "spend_cap", provider: "qloo" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(gate.stub.reserved).toBe(2);
  });

  it("refuses at the hard total", async () => {
    const gate = testGate({ totalCap: 1, dailyCap: 40 });
    const fetchImpl = vi.fn(async () => ok(PLACES));
    const client = liveClient(fetchImpl, gate);
    await client.search({ query: "Muji" });
    await expect(client.search({ query: "Blue Bottle" })).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("serves a saved response without a call or a credit", async () => {
    const gate = testGate();
    const fetchImpl = vi.fn(async () => ok(PLACES));
    const client = liveClient(fetchImpl, gate);
    const first = await client.insights({ "filter.type": "urn:entity:place", take: 5, "filter.tags": "a,b" });
    // Same request, params in another order: one cache entry.
    const second = await client.insights({ "filter.tags": "a,b", take: 5, "filter.type": "urn:entity:place" });
    expect(first.mode).toBe("live");
    expect(second.mode).toBe("cache");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate.stub.reserved).toBe(1);
  });

  it("cache-only mode (regenerate, page loads) never calls and never reserves", async () => {
    const gate = testGate();
    const fetchImpl = vi.fn(async () => ok(PLACES));
    const warm = liveClient(fetchImpl, gate);
    await warm.search({ query: "Muji" });
    const readOnly = liveClient(fetchImpl, gate, { cacheOnly: true });
    expect((await readOnly.search({ query: "Muji" })).mode).toBe("cache");
    await expect(readOnly.search({ query: "Never asked before" })).rejects.toMatchObject({ code: "spend_cap" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate.stub.reserved).toBe(1);
  });

  it("a live client without a gate cannot reach Qloo at all", async () => {
    const fetchImpl = vi.fn(async () => ok(PLACES));
    await expect(liveClient(fetchImpl, null).search({ query: "Muji" })).rejects.toMatchObject({ code: "spend_cap" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not retry a live call (a retry is another billed call the ledger did not count)", async () => {
    const gate = testGate();
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(liveClient(fetchImpl, gate).search({ query: "Muji" })).rejects.toMatchObject({ code: "upstream_5xx" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate.stub.reserved).toBe(1); // counted, never refunded
  });

  it("does not save a failed call or a malformed answer", async () => {
    const cache = memoryCache();
    const gate = testGate({}, cache);
    const bad = vi.fn(async () => ok([1, 2, 3]));
    await expect(liveClient(bad, gate).search({ query: "Muji" })).rejects.toMatchObject({ code: "invalid_response" });
    const good = vi.fn(async () => ok(PLACES));
    expect((await liveClient(good, gate).search({ query: "Muji" })).mode).toBe("live");
  });

  it("replay and fixture runs never touch the ledger", async () => {
    const reserve = vi.fn();
    const client = new QlooClient({ mode: "fixture", status: "fixture", recorder: new MemoryRecorder(), sleep: noSleep, gate: async () => ({ ledger: { reserve, usage: vi.fn() }, cache: memoryCache() }) });
    await client.search({ query: "Muji", types: "urn:entity:brand" });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("a ledger that cannot be reached refuses the call instead of spending", async () => {
    const stub = { ...fakeBudgetStub(), reserve: async () => { throw new Error("DO down"); } };
    const gate = { ledger: createQlooLedger({ stub }), cache: memoryCache() };
    const fetchImpl = vi.fn(async () => ok(PLACES));
    await expect(liveClient(fetchImpl, gate as never).search({ query: "Muji" })).rejects.toMatchObject({ code: "spend_cap" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports usage for /api/limits", async () => {
    const stub = fakeBudgetStub();
    const ledger = createQlooLedger({ stub });
    await ledger.reserve(3);
    expect(await qlooCallsUsed(ledger)).toEqual({ total: 3, today: 3, totalCap: 300, dailyCap: 40 });
  });

  it("the per-process fallback enforces the same caps", async () => {
    const ledger = createQlooLedger({ stub: null, totalCap: 1_000_001, dailyCap: 2 });
    await ledger.reserve();
    await ledger.reserve();
    await expect(ledger.reserve()).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("regenerate has no way to reach Qloo (it rewrites one item from stored evidence)", () => {
    const src = readFileSync("src/server/agent/regenerate.ts", "utf8");
    expect(src).not.toMatch(/qloo/i);
  });
  it("replay mode (the production default) serves a saved real answer first, with no call and no credit, then falls back to the fixtures", async () => {
    const gate = testGate();
    const live = liveClient(vi.fn(async () => ok(PLACES)), gate);
    await live.search({ query: "Muji", types: "urn:entity:brand" }); // a live answer, saved
    const reserved = gate.stub.reserved;
    const replay = new QlooClient({ mode: "replay", status: "replay", recorder: new MemoryRecorder(), sleep: noSleep, gate: async () => gate });
    expect((await replay.search({ query: "Muji", types: "urn:entity:brand" })).mode).toBe("cache");
    expect((await replay.search({ query: "Aesop", types: "urn:entity:brand" })).mode).toBe("fixture"); // nothing saved: synthetic
    expect(gate.stub.reserved).toBe(reserved);
  });
});
