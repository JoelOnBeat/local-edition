import type { z } from "zod";
import type { ProviderMode } from "@/contract";
import { serverEnv, type ServerEnv } from "@/lib/env";
import { UpstreamError } from "../http/errors";
import { fetchJson, type ProviderRunMode } from "../http/fetch-json";
import type { Recorder } from "../http/recorder";
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

export interface QlooCall<T> {
  data: T;
  mode: "live" | "replay" | "fixture";
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
        retries: this.cfg.retries,
        recorder: this.cfg.recorder,
        fetchImpl: this.cfg.fetchImpl,
        sleep: this.cfg.sleep,
        random: this.cfg.random,
      });
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
  return new QlooClient({ mode, status, apiKey: env.QLOO_API_KEY, ...rest });
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
