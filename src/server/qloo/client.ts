import type { z } from "zod";
import type { ProviderMode } from "@/contract";
import { serverEnv, type ServerEnv } from "@/lib/env";
import { UpstreamError } from "../http/errors";
import { fetchJson, type ProviderRunMode } from "../http/fetch-json";
import type { Recorder } from "../http/recorder";
import { getRepo } from "../store";
import { createQlooLedger, QLOO_RESPONSE_TTL_SECONDS, type QlooLedger } from "./ledger";
import {
  AudiencesEnvelope,
  CompareEnvelope,
  InsightsEnvelope,
  SearchEnvelope,
  TagsEnvelope,
  TrendingEnvelope,
} from "./types";

/** The hackathon key only works on this host. Header `X-Api-Key`, GET with query params. */
export const QLOO_HOST = "https://hackathon.api.qloo.com";
export const QLOO_PROVIDER = "qloo";

export type ParamValue = string | number | boolean | readonly string[] | undefined;
export type Params = Record<string, ParamValue>;
/** `/v2/insights` always needs a `filter.type`. */
export type InsightsQuery = Params & { "filter.type": string };

/** What a live call needs: the hard call ledger and a long-lived response cache (KV on Workers). */
export interface QlooGate {
  ledger: QlooLedger;
  cache: { get<T>(key: string): Promise<T | null>; put<T>(key: string, value: T, ttlSeconds: number): Promise<void> };
}

export interface QlooCall<T> {
  data: T;
  /** `cache` = a saved live response served without a call or a credit. */
  mode: "live" | "replay" | "fixture" | "cache";
  /** Path only, never a host or key. */
  path: string;
  /** Query params exactly as sent (the key travels in a header, never here). */
  params: Record<string, string>;
}

export interface QlooClientConfig {
  mode: ProviderRunMode;
  /** Status reported to /api/status: `missing-key` when live was requested without a key. */
  status: ProviderMode;
  apiKey?: string;
  baseUrl?: string;
  recorder?: Recorder;
  timeoutMs?: number;
  retries?: number;
  /**
   * Live runs only. Resolved per call (a Worker isolate outlives requests, so the repo is found at use time). Every live call
   * checks the response cache first, then reserves one call from the ledger BEFORE it goes out. Without a gate a live client
   * refuses to call (`spend_cap`): there is no way to reach Qloo around the ledger.
   */
  gate?: () => Promise<QlooGate | null>;
  /** Live runs only: answer from saved responses, never call (regenerate and page loads use this). */
  cacheOnly?: boolean;
  // Test seams.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Live without a key falls back to replay (then fixture); the status reports `missing-key`. */
export function resolveQlooMode(env: Pick<ServerEnv, "QLOO_MODE" | "QLOO_API_KEY">): {
  mode: ProviderRunMode;
  status: ProviderMode;
} {
  if (env.QLOO_MODE === "live" && !env.QLOO_API_KEY) return { mode: "replay", status: "missing-key" };
  return { mode: env.QLOO_MODE, status: env.QLOO_MODE };
}

export function normalizeParams(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const s = typeof v === "string" ? v : Array.isArray(v) ? v.join(",") : String(v);
    if (s !== "") out[k] = s;
  }
  return out;
}

/** `qloo:resp:v1:<sha256 of path and sorted params>`: the key (header) is never part of it. */
async function responseKey(path: string, params: Record<string, string>): Promise<string> {
  const text = `${path}?${Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `qloo:resp:v1:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40)}`;
}

/** The production gate: the global ledger and the app's repo cache (KV on Workers). */
export const defaultGate = async (): Promise<QlooGate> => {
  const repo = await getRepo();
  return { ledger: createQlooLedger(), cache: { get: (k) => repo.cacheGet(k), put: (k, v, ttl) => repo.cachePut(k, v, ttl) } };
};

const enc = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ":").replace(/%2C/gi, ",");

export function buildUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join("&");
  return `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
}

export class QlooClient {
  readonly mode: ProviderRunMode;
  readonly status: ProviderMode;

  constructor(private readonly cfg: QlooClientConfig) {
    this.mode = cfg.mode;
    this.status = cfg.status;
  }

  /** One GET through `fetchJson`. Replay misses fall back to the synthetic fixture for these params. */
  async call<T>(path: string, query: Params, schema: z.ZodType<T>): Promise<QlooCall<T>> {
    const params = normalizeParams(query);
    const url = buildUrl(this.cfg.baseUrl ?? QLOO_HOST, path, params);
    let gate: QlooGate | null = null;
    let cacheKey = "";
    if (this.mode === "live") {
      gate = (await this.cfg.gate?.().catch(() => null)) ?? null;
      if (!gate) throw new UpstreamError("spend_cap", QLOO_PROVIDER, "Live Qloo calls are not available right now. Using the saved taste data instead.");
      cacheKey = await responseKey(path, params);
      const saved = await gate.cache.get<unknown>(cacheKey).catch(() => null);
      const parsed = saved === null ? null : schema.safeParse(saved);
      if (parsed?.success) return { data: parsed.data, mode: "cache", path, params };
      if (this.cfg.cacheOnly) throw new UpstreamError("spend_cap", QLOO_PROVIDER, "This page uses saved Qloo data and makes no new call.");
      await gate.ledger.reserve(1); // throws the spend_cap UpstreamError when the total or today's slice is spent
    }
    try {
      const res = await fetchJson<T>({
        provider: QLOO_PROVIDER,
        method: "GET",
        url,
        headers: this.cfg.apiKey ? { "X-Api-Key": this.cfg.apiKey } : {},
        mode: this.mode,
        schema,
        fixture: async () => {
          const { respond } = await import("./fixtures/router");
          return respond(path, params) as T;
        },
        timeoutMs: this.cfg.timeoutMs ?? 20_000,
        // A retry is another billed call at Qloo, and the ledger counted one: live calls are not retried.
        retries: this.mode === "live" ? (this.cfg.retries ?? 0) : this.cfg.retries,
        recorder: this.cfg.recorder,
        fetchImpl: this.cfg.fetchImpl,
        sleep: this.cfg.sleep,
        random: this.cfg.random,
      });
      if (gate && res.mode === "live") await gate.cache.put(cacheKey, res.data, QLOO_RESPONSE_TTL_SECONDS).catch(() => undefined);
      return { data: res.data, mode: res.mode, path, params };
    } catch (e) {
      if (e instanceof UpstreamError && e.code === "unauthorized" && e.status === 403) {
        throw new UpstreamError("unauthorized", QLOO_PROVIDER, "Qloo has not enabled this kind of data for this key.", { status: 403 });
      }
      throw e;
    }
  }

  search(query: Params) {
    return this.call("/search", query, SearchEnvelope);
  }
  entities(query: Params) {
    return this.call("/entities", query, SearchEnvelope);
  }
  insights(query: InsightsQuery) {
    return this.call("/v2/insights", query, InsightsEnvelope);
  }
  tags(query: Params) {
    return this.call("/v2/tags", query, TagsEnvelope);
  }
  audiences(query: Params) {
    return this.call("/v2/audiences", query, AudiencesEnvelope);
  }
  compare(query: Params) {
    return this.call("/v2/analysis/compare", query, CompareEnvelope);
  }
  trending(query: Params) {
    return this.call("/v2/trending", query, TrendingEnvelope);
  }
}

/** 403 from Qloo = "entity type not enabled for this key": callers fall back instead of failing. */
export function isForbidden(e: unknown): boolean {
  return e instanceof UpstreamError && e.code === "unauthorized" && e.status === 403;
}

export function createQlooClient(overrides: Partial<QlooClientConfig> & { env?: ServerEnv } = {}): QlooClient {
  const env = overrides.env ?? serverEnv();
  const { mode, status } = resolveQlooMode(env);
  const { env: _env, ...rest } = overrides;
  void _env;
  return new QlooClient({ mode, status, apiKey: env.QLOO_API_KEY, gate: defaultGate, ...rest });
}

let shared: QlooClient | undefined;
export function getQlooClient(): QlooClient {
  shared ??= createQlooClient();
  return shared;
}
export function resetQlooClient(): void {
  shared = undefined;
}

/** For /api/status: the Qloo provider mode, `missing-key` when live was asked for without a key. */
export function qlooProviderStatus(env: ServerEnv = serverEnv()): ProviderMode {
  return resolveQlooMode(env).status;
}
