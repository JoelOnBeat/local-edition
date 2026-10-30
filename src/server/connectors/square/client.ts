import type { z } from "zod";
import { fetchJson, type ProviderRunMode } from "../../http/fetch-json";
import { UpstreamError } from "../../http/errors";
import { baseUrl, SQUARE_VERSION } from "./config";
import {
  CreateLocationResponse, CreateSubscriptionResponse, ListLocationsResponse, ListSubscriptionsResponse, MerchantResponse,
  RetrieveCatalogResponse, RotateKeyResponse, SearchCatalogResponse, SearchOrdersResponse, TokenResponse, UpsertCatalogResponse,
  type CatalogObjectT, type SquareLocation,
} from "./schemas";

export interface SquareClientOptions {
  accessToken: string;
  env: "sandbox" | "production";
  mode?: ProviderRunMode;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  retries?: number;
}

const PROVIDER = "square";

/**
 * Square's REST API over fetch. Every request pins `Square-Version`; every response is checked against the schemas in
 * schemas.ts. External HTTP goes through fetchJson (retry on 429/5xx, timeout, record/replay).
 */
export class SquareClient {
  constructor(private readonly o: SquareClientOptions) {}

  private call<T>(method: "GET" | "POST" | "DELETE", path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return fetchJson<T>({
      provider: PROVIDER,
      method,
      url: `${baseUrl(this.o.env)}${path}`,
      headers: { authorization: `Bearer ${this.o.accessToken}`, "square-version": SQUARE_VERSION },
      ...(body === undefined ? {} : { body }),
      schema,
      mode: this.o.mode ?? "live",
      fetchImpl: this.o.fetchImpl,
      retries: this.o.retries,
      timeoutMs: 20_000,
    }).then((r) => r.data);
  }

  async merchant(): Promise<{ id: string; businessName: string | null }> {
    const r = await this.call("GET", "/v2/merchants/me", undefined, MerchantResponse);
    if (!r.merchant) throw new UpstreamError("invalid_response", PROVIDER, "Square did not return the merchant.");
    return { id: r.merchant.id, businessName: r.merchant.business_name ?? null };
  }

  async listLocations(): Promise<SquareLocation[]> {
    const r = await this.call("GET", "/v2/locations", undefined, ListLocationsResponse);
    return (r.locations ?? []).filter((l) => l.status === undefined || l.status === "ACTIVE");
  }

  /** CreateLocation takes only `location` (no idempotency key): callers check by name first, as scripts/square-seed.ts does. */
  async createLocation(location: Record<string, unknown>): Promise<SquareLocation> {
    const r = await this.call("POST", "/v2/locations", { location }, CreateLocationResponse);
    if (!r.location) throw new UpstreamError("invalid_response", PROVIDER, "Square did not return the new location.");
    return r.location;
  }

  /** Every ITEM and CATEGORY (SearchCatalogObjects, paged by cursor in the body so recordings stay distinct). */
  async fetchCatalog(types: readonly string[] = ["ITEM", "CATEGORY"]): Promise<CatalogObjectT[]> {
    const out: CatalogObjectT[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.call("POST", "/v2/catalog/search", { object_types: types, limit: 100, ...(cursor ? { cursor } : {}) }, SearchCatalogResponse);
      out.push(...(r.objects ?? []));
      cursor = r.cursor;
      if (!cursor) return out;
    }
    throw new UpstreamError("invalid_response", PROVIDER, "Square's catalog is larger than we import in one pass.");
  }

  /** The object, or null when Square no longer has it (deleted in the dashboard). */
  async retrieveObject(id: string): Promise<CatalogObjectT | null> {
    try {
      const r = await this.call("GET", `/v2/catalog/object/${encodeURIComponent(id)}`, undefined, RetrieveCatalogResponse);
      return r.object && !r.object.is_deleted ? r.object : null;
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) return null;
      throw e;
    }
  }

  /** UpsertCatalogObject. Full replacement: send every field and every variation you want to keep. */
  async upsertObject(idempotencyKey: string, object: CatalogObjectT | Record<string, unknown>): Promise<{ object: CatalogObjectT; idMappings: Record<string, string> }> {
    const r = await this.call("POST", "/v2/catalog/object", { idempotency_key: idempotencyKey, object }, UpsertCatalogResponse);
    if (!r.catalog_object) throw new UpstreamError("invalid_response", PROVIDER, "Square did not return the catalog object.");
    const idMappings: Record<string, string> = {};
    for (const m of r.id_mappings ?? []) if (m.client_object_id && m.object_id) idMappings[m.client_object_id] = m.object_id;
    return { object: r.catalog_object, idMappings };
  }

  /** Completed orders closed since `since` at one location; returns the units sold of each catalog variation id. */
  async soldSince(locationId: string, since: string): Promise<Map<string, number>> {
    const sold = new Map<string, number>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await this.call(
        "POST",
        "/v2/orders/search",
        {
          location_ids: [locationId],
          limit: 500,
          ...(cursor ? { cursor } : {}),
          query: { filter: { state_filter: { states: ["COMPLETED"] }, date_time_filter: { closed_at: { start_at: since } } } },
        },
        SearchOrdersResponse,
      );
      for (const order of r.orders ?? []) {
        for (const line of order.line_items ?? []) {
          const qty = Number(line.quantity ?? "0");
          if (line.catalog_object_id && Number.isFinite(qty)) sold.set(line.catalog_object_id, (sold.get(line.catalog_object_id) ?? 0) + qty);
        }
      }
      cursor = r.cursor;
      if (!cursor) break;
    }
    return sold;
  }

  // Webhook subscriptions (used by scripts/square-webhook.ts).
  async listSubscriptions() {
    return (await this.call("GET", "/v2/webhooks/subscriptions", undefined, ListSubscriptionsResponse)).subscriptions ?? [];
  }
  async createSubscription(sub: { name: string; eventTypes: string[]; notificationUrl: string }, idempotencyKey: string) {
    const r = await this.call(
      "POST",
      "/v2/webhooks/subscriptions",
      { idempotency_key: idempotencyKey, subscription: { name: sub.name, event_types: sub.eventTypes, notification_url: sub.notificationUrl, api_version: SQUARE_VERSION, enabled: true } },
      CreateSubscriptionResponse,
    );
    if (!r.subscription) throw new UpstreamError("invalid_response", PROVIDER, "Square did not return the subscription.");
    return r.subscription;
  }
  async rotateSignatureKey(subscriptionId: string, idempotencyKey: string): Promise<string | undefined> {
    return (await this.call("POST", `/v2/webhooks/subscriptions/${encodeURIComponent(subscriptionId)}/signature-key`, { idempotency_key: idempotencyKey }, RotateKeyResponse)).signature_key;
  }
}

/** OAuth token calls: authenticated by the application's id and secret in the body, not by a bearer token. */
export async function obtainToken(
  o: { env: "sandbox" | "production"; mode?: ProviderRunMode; fetchImpl?: typeof fetch },
  body: Record<string, string>,
) {
  return (
    await fetchJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl(o.env)}/oauth2/token`,
      headers: { "square-version": SQUARE_VERSION },
      body,
      schema: TokenResponse,
      mode: o.mode ?? "live",
      fetchImpl: o.fetchImpl,
      record: false, // the response carries tokens: never written to a recording
      retries: 1,
      timeoutMs: 20_000,
    })
  ).data;
}

/** Revokes an OAuth access token (disconnect). Authenticated as the application: `Authorization: Client <secret>`. */
export async function revokeToken(
  o: { env: "sandbox" | "production"; mode?: ProviderRunMode; fetchImpl?: typeof fetch },
  app: { appId: string; appSecret: string },
  accessToken: string,
): Promise<void> {
  await fetchJson({
    provider: PROVIDER,
    method: "POST",
    url: `${baseUrl(o.env)}/oauth2/revoke`,
    headers: { "square-version": SQUARE_VERSION, authorization: `Client ${app.appSecret}` },
    body: { client_id: app.appId, access_token: accessToken },
    mode: o.mode ?? "live",
    fetchImpl: o.fetchImpl,
    record: false,
    retries: 1,
    timeoutMs: 15_000,
  });
}
