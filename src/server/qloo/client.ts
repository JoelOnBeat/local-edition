import type { z } from "zod";
import type { ProviderMode } from "@/contract";
import { serverEnv, type ServerEnv } from "@/lib/env";
import { UpstreamError } from "../http/errors";
import { fetchJson, type ProviderRunMode } from "../http/fetch-json";
import type { Recorder } from "../http/recorder";
import { getRepo } from "../store";
import { qlooLiveOnly } from "./mode";
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
  /** `cache` = a saved live response served without a call or a credit. `replay` and `fixture` exist only outside production (unit tests, `next dev`). */
  mode: "live" | "replay" | "fixture" | "cache";
  /** When Qloo answered: now for a live call, the time the answer was saved for a cached one. ISO 8601. Absent offline (tests, `next dev`). */
  at?: string;
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
   * refuses to call (`qloo_unavailable`): there is no way to reach Qloo around the ledger.
   */
  gate?: () => Promise<QlooGate | null>;
  /** Live runs only: answer from saved responses, never call (regenerate and page loads use this). */
  cacheOnly?: boolean;
  // Test seams.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * Production: always `live`; without a key the status says `missing-key` and every call fails with `qloo_unavailable`.
 * Elsewhere, live without a key falls back to replay (then fixture), as before, so dev and tests need no key.
 */
export function resolveQlooMode(env: Pick<ServerEnv, "QLOO_MODE" | "QLOO_API_KEY">): {
  mode: ProviderRunMode;
  status: ProviderMode;
} {
  if (qlooLiveOnly()) return { mode: "live", status: env.QLOO_API_KEY ? "live" : "missing-key" };
  if (env.QLOO_MODE === "live" && !env.QLOO_API_KEY) return { mode: "replay", status: "missing-key" };
  return { mode: env.QLOO_MODE, status: env.QLOO_MODE };
}

const unavailable = (message: string, status = 503) => new UpstreamError("qloo_unavailable", QLOO_PROVIDER, message, { status, retryable: true });

export function normalizeParams(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const s = typeof v === "string" ? v : Array.isArray(v) ? v.join(",") : String(v);
    if (s !== "") out[k] = s;
  }
  return out;
}

/**
 * The hackathon key allows 10 requests a second (`x-second-ratelimit-limit`, observed 30 Oct) and 50,000 a month. A block profile fans out
 * to seven tag queries and a build runs stores side by side, so live calls share at most 4 in flight per isolate; a 429 would end a
 * probe-sized budget faster than any cap.
 */
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function takeSlot(): Promise<() => void> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  else inFlight++;
  return () => {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  };
}

/** What the response cache holds: a real Qloo answer and when we got it. */
interface SavedResponse {
  at: string;
  data: unknown;
}

/** `qloo:resp:v2:<sha256 of path and sorted params>`: the key (header) is never part of it. v1 (raw bodies, no time) is no longer read. */
async function responseKey(path: string, params: Record<string, string>): Promise<string> {
  const text = `${path}?${Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `qloo:resp:v2:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40)}`;
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

  /**
   * One GET. Live: the saved real answer first (no call, no credit), else one call reserved on the ledger BEFORE it goes out, and the
   * answer is saved for two weeks. Failures throw `qloo_unavailable` or `qloo_budget`; no sample answer ever stands in. Replay and
   * fixture modes exist for unit tests and `next dev` only and are refused where `qlooLiveOnly()`.
   */
  async call<T>(path: string, query: Params, schema: z.ZodType<T>): Promise<QlooCall<T>> {
    const params = normalizeParams(query);
    if (this.mode !== "live") {
      if (qlooLiveOnly()) throw unavailable("Qloo is only called live in production. This answer is not available.");
      return this.callOffline(path, params, schema);
    }
    if (!this.cfg.apiKey) throw unavailable("Qloo is not connected on this server. Nothing was called.");
    const gate = (await this.cfg.gate?.().catch(() => null)) ?? null;
    if (!gate) throw unavailable("The Qloo call ledger is not available, so no live call was made. Try again.");

    const cacheKey = await responseKey(path, params);
    const saved = await gate.cache.get<SavedResponse>(cacheKey).catch(() => null);
    const parsed = saved && typeof saved.at === "string" ? schema.safeParse(saved.data) : null;
    if (saved && parsed?.success) return { data: parsed.data, mode: "cache", at: saved.at, path, params };
    if (this.cfg.cacheOnly) throw unavailable("This page uses saved Qloo answers and makes no new call.");

    await gate.ledger.reserve(1); // throws `qloo_budget` (a cap is spent) or `qloo_unavailable` (the ledger cannot be read)
    const release = await takeSlot();
    try {
      const res = await fetchJson<T>({
        provider: QLOO_PROVIDER,
        method: "GET",
        url: buildUrl(this.cfg.baseUrl ?? QLOO_HOST, path, params),
        headers: { "X-Api-Key": this.cfg.apiKey },
        mode: "live",
        schema,
        timeoutMs: this.cfg.timeoutMs ?? 20_000,
        // A retry is another billed call at Qloo, and the ledger counted one: live calls are not retried.
        retries: this.cfg.retries ?? 0,
        // Real Qloo answers live only in the KV response cache, never in a recorder or a repo.
        record: false,
        fetchImpl: this.cfg.fetchImpl,
        sleep: this.cfg.sleep,
        random: this.cfg.random,
      });
      const at = new Date().toISOString();
      await gate.cache.put<SavedResponse>(cacheKey, { at, data: res.data }, QLOO_RESPONSE_TTL_SECONDS).catch(() => undefined);
      return { data: res.data, mode: "live", at, path, params };
    } catch (e) {
      if (e instanceof UpstreamError && e.code === "unauthorized" && e.status === 403) {
        throw new UpstreamError("unauthorized", QLOO_PROVIDER, "Qloo has not enabled this kind of data for this key.", { status: 403 });
      }
      if (e instanceof UpstreamError && e.code === "qloo_unavailable") throw e;
      throw unavailable(e instanceof UpstreamError && e.code === "timeout" ? "Qloo did not answer in time. Try again." : "Qloo could not answer this request. Try again.");
    } finally {
      release();
    }
  }

  /** Recorded and sample answers for unit tests and `next dev`. Unreachable in production (see `call`). */
  private async callOffline<T>(path: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<QlooCall<T>> {
    const res = await fetchJson<T>({
      provider: QLOO_PROVIDER,
      method: "GET",
      url: buildUrl(this.cfg.baseUrl ?? QLOO_HOST, path, params),
      headers: this.cfg.apiKey ? { "X-Api-Key": this.cfg.apiKey } : {},
      mode: this.mode,
      schema,
      fixture: async () => {
        const { respond } = await import("./fixtures/router");
        return respond(path, params) as T;
      },
      timeoutMs: this.cfg.timeoutMs ?? 20_000,
      retries: this.cfg.retries,
      recorder: this.cfg.recorder,
      fetchImpl: this.cfg.fetchImpl,
      sleep: this.cfg.sleep,
      random: this.cfg.random,
    });
    return { data: res.data, mode: res.mode, path, params };
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
  return new QlooClient({ mode, status, apiKey: env.QLOO_API_KEY, gate: mode === "live" ? defaultGate : undefined, ...rest });
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
