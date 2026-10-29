import type { z } from "zod";
import type { DataMode } from "@/contract";
import { createLogger } from "../log";
import { UpstreamError } from "./errors";
import { canonicalUrl, getRecorder, recordKey, SECRET_HEADER, type Recorder } from "./recorder";
import type { SpendMeter } from "./spend";

const log = createLogger("http");

export type ProviderRunMode = "live" | "replay" | "fixture";

export interface FetchJsonOptions<T> {
  /** Provider name: recordings are stored under it and errors name it. */
  provider: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  /** Object (sent as JSON) or string (sent as-is). */
  body?: unknown;
  /** Provider mode: live calls out, replay reads recordings, fixture only uses `fixture`. Default live. */
  mode?: ProviderRunMode;
  /** Validates the (live or replayed) response; failure -> UpstreamError invalid_response. */
  schema?: z.ZodType<T>;
  /** Replay miss / fixture-mode fallback. */
  fixture?: () => T | Promise<T>;
  timeoutMs?: number;
  /** Retries after the first attempt on 429/5xx/network error. Default 3. */
  retries?: number;
  /** Record successful live responses (default true). */
  record?: boolean;
  recorder?: Recorder;
  /** Token Factory: worst case reserved before a live call, settled after (failures settle at the estimate). */
  meter?: SpendMeter;
  usage?: (data: T) => { model: string; inTokens: number; outTokens: number } | undefined;
  // Test seams.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface FetchJsonResult<T> {
  data: T;
  mode: Extract<DataMode, "live" | "replay" | "fixture">;
  status: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function backoffMs(attempt: number, random: () => number, retryAfterHeader: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 10_000);
  const base = Math.min(250 * 2 ** attempt, 4000);
  return Math.round(base * (0.5 + random())); // jitter: 0.5x to 1.5x
}

function validate<T>(provider: string, data: unknown, schema?: z.ZodType<T>): T {
  if (!schema) return data as T;
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const where = parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") || "(root)").join(", ");
  throw new UpstreamError("invalid_response", provider, `${provider} returned an unexpected response shape at ${where}.`);
}

const REJECTED_FORMAT = /response_format|json_schema|json[ _-]?mode|structured[ _-]?output/i;
const ERROR_BODY_CAP = 4096;

/** Reads at most 4 KB of an error body (inside the request timeout) to learn WHY a 4xx happened; never surfaced. */
async function rejectionHint(res: Response): Promise<"response_format_unsupported" | undefined> {
  try {
    const text = (await res.text()).slice(0, ERROR_BODY_CAP);
    return REJECTED_FORMAT.test(text) ? "response_format_unsupported" : undefined;
  } catch {
    return undefined;
  }
}

async function liveRequest<T>(o: FetchJsonOptions<T>): Promise<{ data: unknown; status: number }> {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? defaultSleep;
  const random = o.random ?? Math.random;
  const retries = o.retries ?? 3;
  const timeoutMs = o.timeoutMs ?? 30_000;
  const method = o.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json", ...o.headers };
  let payload: string | undefined;
  if (o.body !== undefined) {
    payload = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    if (typeof o.body !== "string" && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }
  }

  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retries;
    const ac = new AbortController();
    // One timer covers the headers AND the body: a server that trickles its body cannot hold the call open.
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const timedOut = () => new UpstreamError("timeout", o.provider, `${o.provider} did not answer within ${timeoutMs} ms.`, { retryable: true });
    try {
      let res: Response;
      try {
        // redirect "error": a redirect could carry our custom auth header (e.g. X-Api-Key) to another origin.
        res = await doFetch(o.url, { method, headers, body: payload, signal: ac.signal, redirect: "error" });
      } catch (e) {
        if (ac.signal.aborted) throw timedOut();
        if (last) throw new UpstreamError("network", o.provider, `Could not reach ${o.provider}.`, { retryable: true });
        log.warn("network error, retrying", { provider: o.provider, attempt, err: (e as Error).name });
        await sleep(backoffMs(attempt, random, null));
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        if (last) {
          const code = res.status === 429 ? "rate_limited" : "upstream_5xx";
          throw new UpstreamError(code, o.provider, `${o.provider} is unavailable (HTTP ${res.status}).`, { status: res.status, retryable: true });
        }
        log.warn("retryable status", { provider: o.provider, status: res.status, attempt });
        await sleep(backoffMs(attempt, random, res.headers.get("retry-after")));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new UpstreamError("unauthorized", o.provider, `${o.provider} rejected the credentials.`, { status: res.status });
      }
      if (res.status >= 400) {
        const hint = res.status === 400 || res.status === 422 ? await rejectionHint(res) : undefined;
        throw new UpstreamError("upstream_4xx", o.provider, `${o.provider} rejected the request (HTTP ${res.status}).`, { status: res.status, hint });
      }
      try {
        return { data: await res.json(), status: res.status };
      } catch {
        if (ac.signal.aborted) throw timedOut();
        throw new UpstreamError("bad_json", o.provider, `${o.provider} returned a body that is not JSON.`, { status: res.status });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The one door for external HTTP: retry, timeout, record/replay, fixture fallback, spend cap. */
export async function fetchJson<T = unknown>(o: FetchJsonOptions<T>): Promise<FetchJsonResult<T>> {
  const mode = o.mode ?? "live";
  const method = o.method ?? "GET";
  const recorder = o.recorder ?? getRecorder();

  const fromFixture = async (reason: UpstreamError): Promise<FetchJsonResult<T>> => {
    if (!o.fixture) throw reason;
    return { data: validate(o.provider, await o.fixture(), o.schema), mode: "fixture", status: 200 };
  };

  if (mode === "fixture") {
    return fromFixture(new UpstreamError("no_fixture", o.provider, `No fixture is available for ${o.provider}.`));
  }

  const key = await recordKey({ method, url: o.url, body: o.body });

  if (mode === "replay") {
    const hit = await recorder.get(o.provider, key);
    if (hit) return { data: validate(o.provider, hit.body, o.schema), mode: "replay", status: hit.status };
    return fromFixture(new UpstreamError("replay_miss", o.provider, `No recording for this ${o.provider} request.`));
  }

  // Reserve the worst case first (throws spend_cap); every path below settles the ticket exactly once.
  const ticket = await o.meter?.reserve({ body: o.body });
  let data: unknown;
  let status: number;
  let checked: T;
  try {
    ({ data, status } = await liveRequest(o));
    checked = validate(o.provider, data, o.schema);
  } catch (e) {
    // A failed, timed-out or malformed call may still have been billed: settle at the reserved estimate.
    if (ticket) await o.meter?.settle(ticket).catch(() => undefined);
    throw e;
  }
  if (o.record !== false) {
    try {
      await recorder.put({
        key, provider: o.provider, method, url: canonicalUrl(o.url), status, body: data, recordedAt: new Date().toISOString(),
      });
    } catch (e) {
      log.warn("could not write recording", { provider: o.provider, err: (e as Error).name });
    }
  }
  if (ticket && o.meter) await o.meter.settle(ticket, o.usage?.(checked));
  return { data: checked, mode: "live", status };
}

/** Headers safe to log: secret-bearing ones are dropped. */
export function safeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !SECRET_HEADER.test(k)));
}
