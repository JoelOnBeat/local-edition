import { describe, expect, it } from "vitest";
import { CRAWL_CREDITS, DAILY_CREDIT_CAP, TavilyBudgetError, createLedger, extractCredits, tavilyCreditsUsed } from "./budget";
import { cacheKey, memoryCache, normaliseQuery } from "./cache";

const day1 = () => new Date("2026-10-29T10:00:00Z");
const day2 = () => new Date("2026-10-30T00:05:00Z");

describe("T2 credit budget", () => {
  it("prices calls the way Tavily bills them", () => {
    expect(DAILY_CREDIT_CAP).toBe(10);
    expect(extractCredits(1)).toBe(1);
    expect(extractCredits(5)).toBe(1);
    expect(extractCredits(8)).toBe(2);
    expect(CRAWL_CREDITS).toBe(3);
  });

  it("allows up to 10 credits a day per workspace, then throws 429 tavily_budget", async () => {
    const ledger = createLedger(memoryCache(), day1);
    for (let i = 0; i < 10; i++) await ledger.reserve("ws_a", 1);
    const err = await ledger.reserve("ws_a", 1).catch((e) => e);
    expect(err).toBeInstanceOf(TavilyBudgetError);
    expect(err).toMatchObject({ status: 429, code: "tavily_budget", used: 10, cap: 10 });
    expect(err.message).toMatch(/saved events/);
    await ledger.reserve("ws_b", 3);
    expect((await ledger.used("ws_b")).today).toBe(3);
  });

  it("refuses a call that would cross the cap instead of part-spending it", async () => {
    const ledger = createLedger(memoryCache(), day1);
    await ledger.reserve("ws_a", 9);
    await expect(ledger.reserve("ws_a", 3)).rejects.toBeInstanceOf(TavilyBudgetError);
    expect((await ledger.used("ws_a")).today).toBe(9);
  });

  it("serialises simultaneous reservations so the cap holds", async () => {
    const ledger = createLedger(memoryCache(), day1);
    const settled = await Promise.allSettled(Array.from({ length: 14 }, () => ledger.reserve("ws_a", 1)));
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(10);
  });

  it("starts a fresh allowance each UTC day but keeps the running total for /limits", async () => {
    const cache = memoryCache();
    await createLedger(cache, day1).reserve("ws_a", 10);
    const next = createLedger(cache, day2);
    await next.reserve("ws_a", 4);
    expect(await next.used("ws_a")).toEqual({ today: 4, total: 14, capPerDay: 10 });
    expect(await tavilyCreditsUsed(cache, "ws_a")).toBe(14);
    expect(await tavilyCreditsUsed(cache, "ws_none")).toBe(0);
  });

  it("refunds never go below zero and ignore a corrupt counter", async () => {
    const cache = memoryCache();
    const ledger = createLedger(cache, day1);
    await ledger.refund("ws_a", 5);
    expect((await ledger.used("ws_a")).today).toBe(0);
    await cache.put("tv:credits:total:ws_a", { used: "lots" }, 60);
    expect((await ledger.used("ws_a")).total).toBe(0);
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
