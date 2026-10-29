import { describe, expect, it } from "vitest";
import { TavilyBudgetCore } from "../platform/tavily-budget-core";
import type { TavilyBudgetStub } from "../platform/stubs";
import { CRAWL_CREDITS, DAILY_CREDIT_SLICE, TOTAL_CREDIT_CAP, TavilyBudgetError, createLedger, extractCredits, tavilyCreditsUsed, type LedgerOptions } from "./budget";
import { cacheKey, memoryCache, normaliseQuery } from "./cache";

const day1 = () => new Date("2026-10-29T10:00:00Z");
const day2 = () => new Date("2026-10-30T00:05:00Z");
const S = DAILY_CREDIT_SLICE;

const repoLedger = (cache = memoryCache(), clock = day1, opts: LedgerOptions = {}) => createLedger(cache, clock, { stub: null, ...opts });

describe("T2 credit budget (one GLOBAL ledger)", () => {
  it("prices calls the way Tavily bills them, and sets a hard total of 80 with a daily slice that fits one full 8-store build (8 searches + one page read)", () => {
    expect(TOTAL_CREDIT_CAP).toBe(80);
    expect(DAILY_CREDIT_SLICE).toBeGreaterThanOrEqual(8 * 1 + extractCredits(8));
    expect(DAILY_CREDIT_SLICE).toBeLessThan(TOTAL_CREDIT_CAP);
    expect(extractCredits(1)).toBe(1);
    expect(extractCredits(5)).toBe(1);
    expect(extractCredits(8)).toBe(2);
    expect(CRAWL_CREDITS).toBe(3);
  });

  it("allows the daily slice of credits a day in all, then throws 429 tavily_budget with the saved-events message", async () => {
    const ledger = repoLedger();
    for (let i = 0; i < S; i++) await ledger.reserve(1);
    const err = await ledger.reserve(1).catch((e) => e);
    expect(err).toBeInstanceOf(TavilyBudgetError);
    expect(err).toMatchObject({ status: 429, code: "tavily_budget", reason: "daily", used: S, cap: S });
    expect(err.message).toMatch(/saved events/);
  });

  it("is one counter for the whole app: two ledgers on the same store (two isolates, two workspaces) share it", async () => {
    const cache = memoryCache();
    const a = repoLedger(cache);
    const b = repoLedger(cache);
    await a.reserve(S - 2);
    await expect(b.reserve(3)).rejects.toMatchObject({ code: "tavily_budget", reason: "daily" });
    await b.reserve(2);
    expect(await a.usage()).toEqual({ today: S, total: S, dailyCap: S, totalCap: TOTAL_CREDIT_CAP });
  });

  it("refuses a call that would cross a cap instead of part-spending it", async () => {
    const ledger = repoLedger();
    await ledger.reserve(S - 1);
    await expect(ledger.reserve(2)).rejects.toBeInstanceOf(TavilyBudgetError);
    expect((await ledger.usage()).today).toBe(S - 1);
  });

  it("serialises simultaneous reservations so the slice holds", async () => {
    const ledger = repoLedger();
    const settled = await Promise.allSettled(Array.from({ length: S * 2 + 2 }, () => ledger.reserve(1)));
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(S);
  });

  it("starts a fresh slice each UTC day, keeps the running total, and stops at 80 for good", async () => {
    const cache = memoryCache();
    let now = day1;
    const ledger = createLedger(cache, () => now(), { stub: null, dailyCap: 40 });
    await ledger.reserve(40);
    now = day2;
    await ledger.reserve(40);
    expect(await ledger.usage()).toEqual({ today: 40, total: 80, dailyCap: 40, totalCap: 80 });
    now = () => new Date("2026-10-31T00:05:00Z");
    const err = await ledger.reserve(1).catch((e) => e);
    expect(err).toMatchObject({ code: "tavily_budget", reason: "total", used: 80, cap: 80 });
    expect(await tavilyCreditsUsed(cache)).toBe(80);
  });

  it("refunds go back to the day they came from and never below zero", async () => {
    const cache = memoryCache();
    let now = day1;
    const ledger = createLedger(cache, () => now(), { stub: null });
    const t = await ledger.reserve(3);
    now = day2;
    await ledger.reserve(2);
    await ledger.refund(t); // a day-1 ticket: the total drops, day 2's slice is untouched
    expect(await ledger.usage()).toMatchObject({ today: 2, total: 2 });
    await ledger.refund({ credits: 9, day: "2026-10-30" });
    expect(await ledger.usage()).toMatchObject({ today: 0, total: 0 });
  });

  it("ignores a corrupt counter row", async () => {
    const cache = memoryCache();
    await cache.put("tv:credits:global:v1", { total: "lots" }, 60);
    expect(await repoLedger(cache).usage()).toMatchObject({ total: 0, today: 0 });
  });

  it("holds the repo's best-effort lock around the read-modify-write, and refuses rather than spend without it", async () => {
    const cache = memoryCache();
    const taken = await cache.acquireLock!("tv:credits:lock", 60);
    expect(taken).toBeTruthy();
    const err = await repoLedger(cache).reserve(1).catch((e) => e);
    expect(err).toMatchObject({ code: "tavily_budget", reason: "unavailable" });
    await cache.releaseLock!("tv:credits:lock", taken!);
    await expect(repoLedger(cache).reserve(1)).resolves.toMatchObject({ credits: 1 });
  });
});

describe("T2 credit budget on the Durable Object", () => {
  const stubOf = (core: TavilyBudgetCore): TavilyBudgetStub => core;
  const storage = () => {
    const data = new Map<string, unknown>();
    return {
      async get<T>(k: string) { await new Promise((r) => setTimeout(r, Math.random() * 2)); return data.get(k) as T | undefined; },
      async put(k: string, v: unknown) { await new Promise((r) => setTimeout(r, Math.random() * 2)); data.set(k, structuredClone(v)); },
      async delete(k: string) { return data.delete(k); },
    };
  };

  it("lets exactly the daily slice through, however 40 concurrent reservations interleave", async () => {
    const core = new TavilyBudgetCore(storage(), () => Date.parse("2026-10-29T10:00:00Z"));
    const ledger = createLedger(memoryCache(), day1, { stub: stubOf(core) });
    const results = await Promise.allSettled(Array.from({ length: S * 4 }, () => ledger.reserve(1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(S);
    expect(await ledger.usage()).toMatchObject({ today: S, total: S });
  });

  it("keeps the total across days and refuses past 80", async () => {
    let t = Date.parse("2026-10-29T10:00:00Z");
    const core = new TavilyBudgetCore(storage(), () => t);
    expect(await core.reserve(S, TOTAL_CREDIT_CAP, S)).toMatchObject({ ok: true, today: S, total: S });
    expect(await core.reserve(1, TOTAL_CREDIT_CAP, S)).toMatchObject({ ok: false, reason: "daily" });
    t += 24 * 3600 * 1000;
    expect(await core.reserve(S, TOTAL_CREDIT_CAP, S)).toMatchObject({ ok: true, today: S, total: 2 * S });
    expect(await core.reserve(2, 2 * S + 1, S)).toMatchObject({ ok: false, reason: "total", total: 2 * S });
  });

  it("refuses the live call, and never switches to a fresh KV ledger, when the object errors", async () => {
    const cache = memoryCache();
    const broken: TavilyBudgetStub = {
      reserve: async () => { throw new Error("DO unavailable"); },
      refund: async () => { throw new Error("DO unavailable"); },
      usage: async () => { throw new Error("DO unavailable"); },
    };
    const ledger = createLedger(cache, day1, { stub: broken });
    await expect(ledger.reserve(1)).rejects.toMatchObject({ status: 429, code: "tavily_budget", reason: "unavailable" });
    expect(cache.size()).toBe(0);
    await expect(ledger.refund({ credits: 1, day: "2026-10-29" })).resolves.toBeUndefined();
  });
});

describe("T2 cache keys", () => {
  it("hashes the normalised query and time range; the key holds no query text", async () => {
    const a = await cacheKey("search", "Williamsburg  New York Events", "week");
    expect(a).toBe(await cacheKey("search", " williamsburg new york events ", "week"));
    expect(a).not.toBe(await cacheKey("search", "williamsburg new york events", "month"));
    expect(a).not.toBe(await cacheKey("chain", "williamsburg new york events", "week"));
    expect(a).toMatch(/^tv:search:[0-9a-f]{40}$/);
    expect(normaliseQuery("  A\tB\nC ")).toBe("a b c");
  });

  it("expires entries after their TTL", async () => {
    let now = 0;
    const cache = memoryCache(() => now);
    await cache.put("k", { v: 1 }, 7 * 24 * 3600);
    now = 7 * 24 * 3600 * 1000 - 1;
    expect(await cache.get("k")).toEqual({ v: 1 });
    now += 2;
    expect(await cache.get("k")).toBeNull();
  });
});
