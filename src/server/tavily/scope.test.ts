import { describe, expect, it } from "vitest";
import { MemoryRecorder } from "../http/recorder";
import { SAMPLE_CHAIN_ID, SAMPLE_STORES } from "../sample/chain";
import { createLedger } from "./budget";
import { memoryCache } from "./cache";
import { eventChain, prefetchEventChains } from "./chain";
import { extractPages } from "./extract";
import { resolveRuntime } from "./runtime";
import { isSampleQuery, sampleQueries, workspaceOfChain } from "./scope";
import { searchStore } from "./search";
import { ASTORIA, CHAIN, CLOCK, WILLIAMSBURG, liveEnv, listing, noSleep, tavilyFetch, triageTf } from "./test-utils";

/** H1: live Tavily is for the demo workspace's unmodified sample stores and chain setup; everything else reads saved results. */

const BIG = { dailyCap: 100, totalCap: 1000, stub: null };
const results = [listing("Ceramics opening at Salt Line", "Opening night, Thursday 5 November, 6 to 9pm.", 0.84)];

function setup(caps: Partial<typeof BIG> & { dailyCap?: number } = {}) {
  const net = tavilyFetch({
    search: (body) => ({ query: String(body.query), results }),
    extract: (body) => ({ results: (body.urls as string[]).map((url) => ({ url, raw_content: `Full page for ${url}. Doors at 6pm.` })), failed_results: [] }),
  });
  const tf = triageTf({ "Ceramics opening at Salt Line": { venue: "Salt Line Studio", date: "2026-11-05" } }, { list: () => [] });
  const cache = memoryCache();
  const ledger = createLedger(cache, CLOCK, { ...BIG, ...caps });
  const opts = { env: liveEnv, fetchImpl: net.fetchImpl, tf: tf.tf, cache, ledger, clock: CLOCK, sleep: noSleep, random: () => 0.5, recorder: new MemoryRecorder() };
  return { net, tf, cache, ledger, opts };
}

describe("which queries are sample queries", () => {
  it("is exactly the eight sample stores in the sample city, this week", () => {
    expect(sampleQueries(CLOCK()).size).toBe(SAMPLE_STORES.length);
    expect(isSampleQuery("Williamsburg New York events things to do this week October 26 to November 1 2026", CLOCK())).toBe(true);
  });

  it("is false for a renamed store, another city, another week or a store a visitor added", () => {
    expect(isSampleQuery("Williamsburg Brooklyn events things to do this week October 26 to November 1 2026", CLOCK())).toBe(false);
    expect(isSampleQuery("Williamsburg London events things to do this week October 26 to November 1 2026", CLOCK())).toBe(false);
    expect(isSampleQuery("Williamsburg New York events things to do this week November 2 to November 8 2026", CLOCK())).toBe(false);
    expect(isSampleQuery("Bushwick New York events things to do this week October 26 to November 1 2026", CLOCK())).toBe(false);
  });

  it("names the demo workspace by the sample chain's own id; any other chain is a visitor's", () => {
    expect(workspaceOfChain({ id: SAMPLE_CHAIN_ID })).toBe("demo");
    expect(workspaceOfChain({ id: `${SAMPLE_CHAIN_ID}~k3j9x` })).not.toBe("demo");
  });
});

describe("live search only for the demo workspace's sample stores", () => {
  it("a visitor workspace makes no call and spends no credit: code tavily_budget, reason scope", async () => {
    const { net, opts, ledger } = setup();
    const r = await eventChain(WILLIAMSBURG, CHAIN, { ...opts, workspaceId: "ws_visitor" });
    expect(net.calls).toHaveLength(0);
    expect(r).toMatchObject({ fallback: "tavily_budget", budgetReason: "scope", found: 0, events: [], evidence: [], creditsUsed: 0 });
    expect(await ledger.usage()).toMatchObject({ total: 0 });
  });

  it("a visitor reads the result the demo's build saved, at no cost", async () => {
    const { net, opts, ledger } = setup();
    const demo = await eventChain(WILLIAMSBURG, CHAIN, { ...opts, workspaceId: "demo" });
    expect(demo.creditsUsed).toBe(2);
    const calls = net.calls.length;
    const visitor = await eventChain(WILLIAMSBURG, CHAIN, { ...opts, workspaceId: "ws_visitor" });
    expect(net.calls).toHaveLength(calls);
    expect(visitor).toMatchObject({ fallback: null, found: demo.found, kept: demo.kept });
    expect(visitor.evidence[0].mode).toBe("cache");
    expect(await ledger.usage()).toMatchObject({ total: 2 });
  });

  it("a store renamed or added in the demo workspace is cache-only; a sample store in the same batch still runs live", async () => {
    const { net, opts, ledger } = setup();
    const renamed = { ...ASTORIA, id: "store_astoria", name: "Astoria Heights" };
    const batch = await prefetchEventChains([renamed, WILLIAMSBURG], CHAIN, { ...opts, workspaceId: "demo" });
    expect(batch.results.get(renamed.id)).toMatchObject({ fallback: "tavily_budget", budgetReason: "scope", found: 0 });
    expect(batch.results.get(WILLIAMSBURG.id)).toMatchObject({ fallback: null, extracted: true });
    expect(net.count("search")).toBe(1);
    expect(net.calls.find((c) => c.path === "/search")!.body.query).toContain("Williamsburg New York");
    expect(await ledger.usage()).toMatchObject({ total: 2 });
  });

  it("a sample store searched in another city is out of scope", async () => {
    const { net, opts } = setup();
    const r = await eventChain(WILLIAMSBURG, { ...CHAIN, city: { name: "London", lat: 51.5, lon: -0.12 } }, { ...opts, workspaceId: "demo" });
    expect(net.calls).toHaveLength(0);
    expect(r).toMatchObject({ fallback: "tavily_budget", budgetReason: "scope" });
  });

  it("an extract goes out live only for the URLs of sample-store searches", async () => {
    const { net, opts } = setup();
    const rt = await resolveRuntime({ ...opts, workspaceId: "demo" });
    const read = await extractPages(["https://events.example.com/a", "https://events.example.com/b"], rt, new Set(["https://events.example.com/a"]));
    expect(read.fetched).toEqual(["https://events.example.com/a"]);
    expect(net.calls.filter((c) => c.path === "/extract").map((c) => c.body.urls)).toEqual([["https://events.example.com/a"]]);
    const visitor = await resolveRuntime({ ...opts, workspaceId: "ws_visitor" });
    const none = await extractPages(["https://events.example.com/c"], visitor);
    expect(none.fetched).toEqual([]);
    expect(net.count("extract")).toBe(1);
  });

  it("outside live mode the scope does not matter: replay and fixture runs cost nothing", async () => {
    const r = await eventChain(WILLIAMSBURG, CHAIN, { env: { TAVILY_MODE: "fixture", TAVILY_API_KEY: undefined }, workspaceId: "ws_visitor", clock: CLOCK, tf: triageTf({}, { mode: "fixture" }).tf, recorder: new MemoryRecorder() });
    expect(r.fallback).toBeNull();
    expect(r.found).toBeGreaterThan(0);
  });
});

describe("the global ledger gates every live call, reserved first", () => {
  it("reserves before the request leaves, for the search and for the page read", async () => {
    const order: string[] = [];
    const { opts, net, ledger } = setup();
    const spy = { ...ledger, reserve: async (n: number) => { order.push(`reserve:${n}@${net.calls.length}`); return ledger.reserve(n); } };
    await eventChain(WILLIAMSBURG, CHAIN, { ...opts, ledger: spy, workspaceId: "demo" });
    expect(order).toEqual(["reserve:1@0", "reserve:1@1"]);
  });

  it("8 sample stores against a daily slice of 6: six are searched, two use saved events, and no credit is spent past the slice", async () => {
    const { net, opts, ledger } = setup({ dailyCap: 6 });
    const stores = SAMPLE_STORES;
    const batch = await prefetchEventChains(stores, CHAIN, { ...opts, workspaceId: "demo" });
    expect(net.count("search")).toBe(6);
    expect(net.count("extract")).toBe(0); // the slice is spent, so the page read is skipped
    expect(stores.slice(6).map((s) => batch.results.get(s.id))).toEqual([
      expect.objectContaining({ fallback: "tavily_budget", budgetReason: "daily" }),
      expect.objectContaining({ fallback: "tavily_budget", budgetReason: "daily" }),
    ]);
    expect(await ledger.usage()).toMatchObject({ today: 6, total: 6, dailyCap: 6 });
    // Tomorrow's slice picks up the two that are missing; the six saved ones cost nothing.
    const tomorrow = createLedger(opts.cache, () => new Date("2026-10-30T04:00:00Z"), { ...BIG, dailyCap: 6 });
    const next = await prefetchEventChains(stores, CHAIN, { ...opts, ledger: tomorrow, clock: () => new Date("2026-10-29T05:00:00Z"), workspaceId: "demo" });
    expect(next.results.get(stores[7].id)).toMatchObject({ fallback: null });
  });

  it("the hard total stops everything: no live call once 80 credits are gone", async () => {
    const { net, opts, ledger } = setup({ totalCap: 3 });
    await ledger.reserve(3);
    const r = await eventChain(WILLIAMSBURG, CHAIN, { ...opts, workspaceId: "demo" });
    expect(net.calls).toHaveLength(0);
    expect(r).toMatchObject({ fallback: "tavily_budget", budgetReason: "total" });
  });

  it("searchStore alone, outside the chain, is gated the same way", async () => {
    const { net, opts } = setup();
    const rt = await resolveRuntime({ ...opts, workspaceId: "ws_visitor" });
    await expect(searchStore(WILLIAMSBURG, rt, "New York")).rejects.toMatchObject({ code: "tavily_budget", reason: "scope" });
    expect(net.calls).toHaveLength(0);
  });
});
