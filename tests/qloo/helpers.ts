import type { Chain, Store } from "@/contract";
import { QlooClient, type QlooClientConfig, type QlooGate } from "@/server/qloo/client";
import { createQlooLedger } from "@/server/qloo/ledger";
import type { TavilyBudgetStub } from "@/server/platform/stubs";
import { memoryCache, type QlooDeps } from "@/server/qloo/deps";
import { MemoryRecorder } from "@/server/http/recorder";
import { SAMPLE_CHAIN, SAMPLE_STORES } from "@/server/sample/chain";

export const NOW = new Date("2026-10-29T10:00:00.000Z");
export const chain: Chain = SAMPLE_CHAIN;
export const store = (slug: string): Store => SAMPLE_STORES.find((s) => s.id === `store_${slug}`)!;
export const noSleep = async () => {};

export function fixtureClient(over: Partial<QlooClientConfig> = {}): QlooClient {
  return new QlooClient({ mode: "fixture", status: "fixture", recorder: new MemoryRecorder(), sleep: noSleep, ...over });
}

export function fixtureDeps(over: Partial<QlooDeps> = {}): QlooDeps {
  return { client: fixtureClient(), cache: memoryCache(), now: () => NOW, ...over };
}

export const ok = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

/** A QlooClient whose insights/compare/trending/search are replaced by test doubles. */
export function stubClient(handlers: Partial<Record<"insights" | "compare" | "trending" | "search", (q: Record<string, unknown>) => unknown>>): {
  client: QlooClient;
  calls: { method: string; query: Record<string, unknown> }[];
} {
  const calls: { method: string; query: Record<string, unknown> }[] = [];
  const client = fixtureClient();
  for (const method of ["insights", "compare", "trending", "search"] as const) {
    const handler = handlers[method];
    if (!handler) continue;
    (client as unknown as Record<string, unknown>)[method] = async (query: Record<string, unknown>) => {
      calls.push({ method, query });
      const data = await handler(query);
      return { data, mode: "live", at: NOW.toISOString(), path: method === "insights" ? "/v2/insights" : `/${method}`, params: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) };
    };
  }
  return { client, calls };
}

export const tagEnv = (tags: { id: string; name: string; affinity: number }[]) => ({
  success: true,
  results: { tags: tags.map((t) => ({ tag_id: t.id, name: t.name, query: { affinity: t.affinity } })) },
});
export const entityEnv = (entities: unknown[]) => ({ success: true, results: { entities } });

/** A stand-in for the ledger's Durable Object: the same check-both-caps-then-take, in memory. */
export function fakeBudgetStub(): TavilyBudgetStub & { reserved: number } {
  const state = { total: 0, today: 0, reserved: 0 };
  return {
    get reserved() { return state.reserved; },
    async reserve(credits, totalCap, dailyCap) {
      const usage = { total: state.total, today: state.today };
      if (state.total + credits > totalCap) return { ok: false, reason: "total", ...usage };
      if (state.today + credits > dailyCap) return { ok: false, reason: "daily", ...usage };
      state.total += credits; state.today += credits; state.reserved += credits;
      return { ok: true, day: "2026-10-30", total: state.total, today: state.today };
    },
    async refund() {},
    async usage() { return { total: state.total, today: state.today, day: "2026-10-30" }; },
  };
}

/** A live-mode gate for transport tests: generous caps unless a test passes its own. */
export function testGate(caps: { totalCap?: number; dailyCap?: number } = {}, cache = memoryCache()): QlooGate & { stub: ReturnType<typeof fakeBudgetStub> } {
  const stub = fakeBudgetStub();
  return { ledger: createQlooLedger({ stub, totalCap: caps.totalCap ?? 1000, dailyCap: caps.dailyCap ?? 1000 }), cache, stub };
}
