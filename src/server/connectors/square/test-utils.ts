import { mockEditions } from "@/mocks/editions";
import { SAMPLE_MENU } from "@/server/sample/chain";
import { ensureDemoWorkspace } from "../../session";
import { createMemoryRepo } from "../../store/memory";
import type { Repo } from "../../store";
import { MemoryLedger } from "../ledger-memory";
import { readSquareConfig } from "./config";
import type { SquareDeps } from "./deps";
import type { CatalogObjectT } from "./schemas";

/**
 * A fake Square (sandbox-shaped responses, labelled synthetic: built from the reference at developer.squareup.com/reference/square,
 * not recorded) behind a fetch function, so the import, webhook, write-back and OAuth code run end to end with no network.
 */

export const TEST_ENV = {
  SQUARE_MODE: "live",
  SQUARE_ACCESS_TOKEN: "sandbox-token-for-tests",
  SQUARE_APP_ID: "sandbox-sq0idb-test-app",
  SQUARE_APP_SECRET: "sandbox-sq0csb-test-secret",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "test-signature-key-0123456789",
  SQUARE_TOKEN_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64"),
  APP_URL: "https://localedition.pages.dev",
} as const;

export interface FakeSquare {
  fetch: typeof fetch;
  calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[];
  catalog: Map<string, CatalogObjectT>;
  locations: { id: string; name: string; status: string; address: Record<string, string> }[];
  /** Set to make the next call to a path prefix fail with this HTTP status. */
  failNext: Map<string, number | { status: number; times: number }>;
  orders: { id: string; line_items: { catalog_object_id: string; quantity: string }[] }[];
  tokens: { issued: number; refreshed: number };
}

const category = (id: string, name: string): CatalogObjectT => ({ type: "CATEGORY", id, version: 1, category_data: { name } });
const itemObject = (slug: string, name: string, cents: number, categoryId: string, description: string): CatalogObjectT => ({
  type: "ITEM", id: `ITEM_${slug}`, version: 10, present_at_all_locations: true,
  item_data: {
    name, description, categories: [{ id: categoryId }], product_type: "REGULAR",
    variations: [{ type: "ITEM_VARIATION", id: `VAR_${slug}`, version: 10, item_variation_data: { item_id: `ITEM_${slug}`, name: "Regular", pricing_type: "FIXED_PRICING", price_money: { amount: cents, currency: "USD" } } }],
  },
});

/** The sample chain's menu as Square would hold it (names and prices equal SAMPLE_MENU, so ids are kept on import). */
export function sampleCatalog(): CatalogObjectT[] {
  const catOf: Record<string, string> = { coffee: "CAT_coffee", cold: "CAT_cold", tea: "CAT_tea", bakery: "CAT_bakery", food: "CAT_food" };
  return [
    category("CAT_coffee", "Coffee"), category("CAT_cold", "Cold drinks"), category("CAT_tea", "Tea"), category("CAT_bakery", "Bakery"), category("CAT_food", "Food"),
    ...SAMPLE_MENU.map((m) => itemObject(m.id.replace(/^menu_/, ""), m.name, Math.round((m.price ?? 0) * 100), catOf[m.category], m.description ?? "")),
  ];
}

export function fakeSquare(initial: CatalogObjectT[] = sampleCatalog(), withLocations = true): FakeSquare {
  const state: FakeSquare = {
    calls: [], catalog: new Map(initial.map((o) => [o.id, o])), failNext: new Map(), orders: [], tokens: { issued: 0, refreshed: 0 },
    locations: (withLocations ? ["Williamsburg", "Park Slope", "Astoria", "Harlem", "West Village", "Lower East Side", "Upper East Side", "Long Island City"] : []).map((n, i) => ({
      id: `LOC_${i + 1}`, name: `Kettle & Kiln ${n}`, status: "ACTIVE", address: { address_line_1: `${100 + i} Test St`, locality: "New York" },
    })),
    fetch: undefined as unknown as typeof fetch,
  };
  const idempotent = new Map<string, unknown>();
  let seq = 0;
  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    state.calls.push({ method, path: url.pathname, body, headers });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    for (const [prefix, fail] of state.failNext) {
      if (!url.pathname.startsWith(prefix)) continue;
      const { status, times } = typeof fail === "number" ? { status: fail, times: 1 } : fail;
      if (times <= 1) state.failNext.delete(prefix); else state.failNext.set(prefix, { status, times: times - 1 });
      return json({ errors: [{ code: "INTERNAL" }] }, status);
    }
    const p = url.pathname;
    if (p === "/v2/merchants/me") return json({ merchant: { id: "MLTESTMERCHANT", business_name: "Kettle & Kiln (sample chain)" } });
    if (p === "/v2/locations" && method === "POST") {
      const loc = { id: `LOC_N${state.locations.length + 1}`, status: "ACTIVE", ...body.location };
      state.locations.push(loc);
      return json({ location: loc });
    }
    if (p === "/v2/locations") return json({ locations: state.locations });
    if (p === "/v2/catalog/search") return json({ objects: [...state.catalog.values()].filter((o) => body.object_types.includes(o.type)) });
    if (p.startsWith("/v2/catalog/object/") && method === "GET") {
      const o = state.catalog.get(decodeURIComponent(p.split("/").pop()!));
      return o ? json({ object: o }) : json({ errors: [{ code: "NOT_FOUND" }] }, 404);
    }
    if (p === "/v2/catalog/object" && method === "POST") {
      const key = body.idempotency_key as string;
      if (idempotent.has(key)) {
        const prior = idempotent.get(key) as { sig: string; res: unknown };
        return JSON.stringify(body.object) === prior.sig ? json(prior.res) : json({ errors: [{ code: "IDEMPOTENCY_KEY_REUSED" }] }, 400);
      }
      const mappings: { client_object_id: string; object_id: string }[] = [];
      const real = (id: string) => {
        if (!id.startsWith("#")) return id;
        const m = mappings.find((x) => x.client_object_id === id) ?? { client_object_id: id, object_id: `SQ${(++seq).toString().padStart(6, "0")}` };
        if (!mappings.includes(m)) mappings.push(m);
        return m.object_id;
      };
      const obj = structuredClone(body.object) as CatalogObjectT;
      const prev = state.catalog.get(obj.id);
      if (prev && obj.version !== undefined && obj.version !== prev.version) return json({ errors: [{ code: "VERSION_MISMATCH" }] }, 409);
      obj.id = real(obj.id);
      obj.version = (prev?.version ?? 0) + 1;
      for (const v of obj.item_data?.variations ?? []) { v.id = real(v.id); v.version = obj.version; if (v.item_variation_data) v.item_variation_data.item_id = obj.id; }
      state.catalog.set(obj.id, obj);
      const res = { catalog_object: obj, id_mappings: mappings };
      idempotent.set(key, { sig: JSON.stringify(body.object), res });
      return json(res);
    }
    if (p === "/v2/orders/search") return json({ orders: state.orders });
    if (p === "/oauth2/token") {
      if (body.grant_type === "authorization_code") {
        if (body.code !== "good-code") return json({ errors: [{ code: "INVALID_REQUEST_ERROR" }] }, 400);
        state.tokens.issued++;
        return json({ access_token: "oauth-access-1", refresh_token: "oauth-refresh-1", expires_at: "2026-11-30T00:00:00Z", merchant_id: "MLTESTMERCHANT" });
      }
      state.tokens.refreshed++;
      return json({ access_token: "oauth-access-2", refresh_token: "oauth-refresh-2", expires_at: "2026-12-30T00:00:00Z", merchant_id: "MLTESTMERCHANT" });
    }
    if (p === "/oauth2/revoke") return json({ success: true });
    return json({ errors: [{ code: "NOT_FOUND" }] }, 404);
  }) as typeof fetch;
  return state;
}

export interface Harness {
  deps: SquareDeps;
  fake: FakeSquare;
  repo: Repo;
  ledger: MemoryLedger;
  workspaceId: string;
  now: { value: Date };
}

/** Memory repo with the demo workspace (canonical sample ids) and the mock editions, a memory ledger and a fake Square. */
export async function harness(env: Record<string, string> = TEST_ENV): Promise<Harness> {
  const repo = createMemoryRepo();
  await ensureDemoWorkspace(repo);
  for (const e of mockEditions) await repo.putEdition(structuredClone(e));
  const ledger = new MemoryLedger();
  const fake = fakeSquare();
  const now = { value: new Date("2026-10-30T18:07:00Z") };
  const deps: SquareDeps = { ledger, repo, config: readSquareConfig(env), fetchImpl: fake.fetch, now: () => now.value };
  return { deps, fake, repo, ledger, workspaceId: "demo", now };
}
