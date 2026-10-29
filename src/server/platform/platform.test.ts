import { afterEach, describe, expect, it } from "vitest";
import { acquireBuildLock, releaseBuildLock } from "../agent/build-lock";
import { createMemoryRepo } from "../store/memory";
import { reserveSpend, resetTokenFactoryMeter, settleSpend, tokenFactoryMeter } from "../tokenfactory/spend";
import { resetEnvCache } from "@/lib/env";
import { BuildLockCore } from "./lock-core";
import { setPlatformEnv, type PlatformEnv } from "./env";
import { SpendLedgerCore } from "./spend-core";
import { TavilyBudgetCore } from "./tavily-budget-core";
import { DAILY_CREDIT_SLICE, createLedger } from "../tavily/budget";
import { memoryCache } from "../tavily/cache";
import { setRepo } from "../store";
import type { StorageLike } from "./storage";
import type { BuildLockStub, SpendMeterStub } from "./stubs";

/** Map-backed Durable Object storage whose every call yields to the event loop, so interleaving would show. */
function fakeStorage(): StorageLike & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const tick = () => new Promise<void>((r) => setTimeout(r, Math.random() * 2));
  return {
    data,
    async get<T>(key: string) { await tick(); const v = data.get(key); return v === undefined ? undefined : (structuredClone(v) as T); },
    async put(key, value) { await tick(); data.set(key, structuredClone(value)); },
    async delete(key) { await tick(); return data.delete(key); },
  };
}

/** A namespace whose stubs are cores, one per name, shared by every caller (as the real objects are). */
function fakeNamespace<S>(make: () => S) {
  const objects = new Map<string, S>();
  return { objects, idFromName: (name: string) => name, get: (id: unknown) => { const k = String(id); if (!objects.has(k)) objects.set(k, make()); return objects.get(k)!; } };
}

afterEach(() => {
  setPlatformEnv(undefined);
  resetTokenFactoryMeter();
  process.env.SPEND_CAP_USD = "";
  resetEnvCache();
});

describe("SpendLedgerCore (the SpendMeterDO logic)", () => {
  it("lets exactly cap/estimate concurrent reservations through, however they interleave", async () => {
    const core = new SpendLedgerCore(fakeStorage());
    const results = await Promise.all(Array.from({ length: 50 }, () => core.reserve(0.1, 1)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect((await core.totals(1)).usd).toBeCloseTo(1, 6);
  });

  it("settles at the real cost and frees the difference for the next reservation", async () => {
    const core = new SpendLedgerCore(fakeStorage());
    const a = await core.reserve(0.6, 1);
    if (!a.ok) throw new Error("expected a ticket");
    expect((await core.reserve(0.6, 1)).ok).toBe(false);
    await core.settle(a.ticket.id, 0.1);
    expect((await core.totals(1)).usd).toBeCloseTo(0.1, 6);
    expect((await core.reserve(0.6, 1)).ok).toBe(true);
  });

  it("counts a ticket nobody settled as spent after ten minutes, and never twice", async () => {
    let t = 1_000_000;
    const core = new SpendLedgerCore(fakeStorage(), () => t);
    const a = await core.reserve(0.4, 1);
    if (!a.ok) throw new Error("expected a ticket");
    t += 11 * 60_000;
    expect((await core.totals(1)).usd).toBeCloseTo(0.4, 6);
    await core.settle(a.ticket.id, 0.4);
    expect((await core.totals(1)).usd).toBeCloseTo(0.4, 6);
  });

  it("records spend that was never reserved, even past the cap", async () => {
    const core = new SpendLedgerCore(fakeStorage());
    await core.record(2);
    expect((await core.totals(1)).usd).toBeCloseTo(2, 6);
    expect((await core.reserve(0.01, 1)).ok).toBe(false);
  });
});

describe("BuildLockCore (the BuildLockDO logic)", () => {
  it("grants one holder at a time, ignores a wrong-token release, and frees on the right one", async () => {
    const core = new BuildLockCore(fakeStorage());
    const first = await Promise.all(Array.from({ length: 20 }, () => core.acquire(60)));
    expect(first.filter(Boolean)).toHaveLength(1);
    const token = first.find(Boolean)!;
    await core.release("someone-else");
    expect(await core.acquire(60)).toBeNull();
    await core.release(token);
    expect(await core.acquire(60)).toBeTruthy();
  });

  it("lets a lock expire so a dead build cannot block a workspace forever", async () => {
    let t = 5_000;
    const core = new BuildLockCore(fakeStorage(), () => t);
    expect(await core.acquire(30)).toBeTruthy();
    t += 29_000;
    expect(await core.acquire(30)).toBeNull();
    t += 2_000;
    expect(await core.acquire(30)).toBeTruthy();
  });
});

describe("spend.ts and build-lock.ts adapters", () => {
  const withDos = () => {
    const spend = fakeNamespace<SpendMeterStub>(() => new SpendLedgerCore(fakeStorage()));
    const locks = fakeNamespace<BuildLockStub>(() => new BuildLockCore(fakeStorage()));
    setPlatformEnv({ SPEND_METER: spend, BUILD_LOCK: locks } as unknown as PlatformEnv);
    return { spend, locks };
  };

  it("meters spend through the Durable Object when it is bound, shared by two meters (two isolates)", async () => {
    process.env.SPEND_CAP_USD = "1";
    resetEnvCache();
    const { spend } = withDos();
    const repo = createMemoryRepo();
    const a = await reserveSpend(0.6);
    expect(a.id.startsWith("do:")).toBe(true);
    resetTokenFactoryMeter(); // a second isolate builds its own meter over the same object
    await expect(reserveSpend(0.5)).rejects.toMatchObject({ code: "spend_cap" });
    await settleSpend(a, 0.2);
    expect((await tokenFactoryMeter().totals()).usd).toBeCloseTo(0.2, 6);
    expect(await repo.cacheGet("spend:ledger")).toBeNull();
    expect(spend.objects.size).toBe(1);
  });

  it("refuses a spending call with 503 spend_unavailable when the object throws, never a fresh repo ledger", async () => {
    process.env.SPEND_CAP_USD = "1";
    resetEnvCache();
    const broken = { idFromName: () => "x", get: () => ({ reserve: async () => { throw new Error("boom"); }, settle: async () => undefined, record: async () => undefined, totals: async () => { throw new Error("boom"); } }) };
    setPlatformEnv({ SPEND_METER: broken } as unknown as PlatformEnv);
    const repo = createMemoryRepo();
    setRepo(repo);
    // Twice: a second call must not find a separate ledger that started from zero.
    for (let i = 0; i < 2; i++) await expect(reserveSpend(0.7)).rejects.toMatchObject({ status: 503, code: "spend_unavailable" });
    expect(await repo.cacheGet("spend:ledger")).toBeNull();
  });

  it("the Tavily credit ledger rides the TAVILY_BUDGET object when bound: one counter across isolates, and the object failing refuses the call", async () => {
    const budget = fakeNamespace(() => new TavilyBudgetCore(fakeStorage()));
    setPlatformEnv({ TAVILY_BUDGET: budget } as unknown as PlatformEnv);
    const cache = memoryCache();
    const a = createLedger(cache);
    const b = createLedger(cache);
    await a.reserve(DAILY_CREDIT_SLICE - 2);
    await expect(b.reserve(3)).rejects.toMatchObject({ code: "tavily_budget", reason: "daily" });
    expect(await b.usage()).toMatchObject({ total: DAILY_CREDIT_SLICE - 2, today: DAILY_CREDIT_SLICE - 2 });
    expect(budget.objects.size).toBe(1);
    expect(cache.size()).toBe(0); // nothing leaked to the KV fallback

    setPlatformEnv({ TAVILY_BUDGET: { idFromName: () => "x", get: () => ({ reserve: async () => { throw new Error("boom"); }, refund: async () => undefined, usage: async () => ({ total: 0, today: 0, day: "d" }) }) } } as unknown as PlatformEnv);
    await expect(createLedger(cache).reserve(1)).rejects.toMatchObject({ code: "tavily_budget", reason: "unavailable" });
  });

  it("uses the build-lock object per workspace: second build gets 409, release frees it", async () => {
    const { locks } = withDos();
    const repo = createMemoryRepo();
    const lock = await acquireBuildLock(repo, "ws_a");
    expect(lock.backend).toBe("do");
    await expect(acquireBuildLock(repo, "ws_a")).rejects.toMatchObject({ status: 409, code: "build_running" });
    const other = await acquireBuildLock(repo, "ws_b");
    await releaseBuildLock(repo, lock);
    await releaseBuildLock(repo, other);
    await expect(acquireBuildLock(repo, "ws_a")).resolves.toMatchObject({ backend: "do" });
    expect(locks.objects.size).toBe(2);
    expect(await repo.acquireLock("build:ws_a", 5)).toBeTruthy(); // nothing was written to the repo lock
  });

  it("falls back to the repo lock when no object is bound", async () => {
    const repo = createMemoryRepo();
    const lock = await acquireBuildLock(repo, "ws_a");
    expect(lock.backend).toBeUndefined();
    await expect(acquireBuildLock(repo, "ws_a")).rejects.toMatchObject({ code: "build_running" });
    await releaseBuildLock(repo, lock);
    await expect(acquireBuildLock(repo, "ws_a")).resolves.toBeTruthy();
  });
});
