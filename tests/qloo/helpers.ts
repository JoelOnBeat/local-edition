import type { Chain, Store } from "@/contract";
import { QlooClient, type QlooClientConfig } from "@/server/qloo/client";
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
      return { data, mode: "live", path: method === "insights" ? "/v2/insights" : `/${method}`, params: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) };
    };
  }
  return { client, calls };
}

export const tagEnv = (tags: { id: string; name: string; affinity: number }[]) => ({
  success: true,
  results: { tags: tags.map((t) => ({ tag_id: t.id, name: t.name, query: { affinity: t.affinity } })) },
});
export const entityEnv = (entities: unknown[]) => ({ success: true, results: { entities } });
