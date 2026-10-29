import type { Evidence, Store } from "@/contract";
import { serverEnv, type ServerEnv } from "@/lib/env";
import { newId } from "@/lib/ids";
import { fetchJson } from "../http/fetch-json";
import type { Recorder } from "../http/recorder";
import { tavilyFixture } from "./fixtures";
import { buildTavilyBody, TAVILY_SEARCH_URL, tavilyParams, type TavilyRequest } from "./request";
import { tavilyModeFor } from "./mode";
import { TavilyResponse, type TavilyResult } from "./schema";

/** What the edition agent gets for one store: event listings for this week plus one evidence row. */
export interface TavilyEvent {
  title: string;
  url: string;
  date?: string;
  snippet: string;
}

export interface EventsThisWeek {
  events: TavilyEvent[];
  evidence: Evidence;
}

export interface TavilyOptions {
  /** Defaults to the parsed server env. Tests pass their own. */
  env?: Pick<ServerEnv, "TAVILY_MODE" | "TAVILY_API_KEY">;
  recorder?: Recorder;
  // Test seams, passed through to fetchJson.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  clock?: () => Date;
}

const SNIPPET_MAX = 280;

/** Keeps only http(s) links; anything else is dropped rather than shown. */
export function httpUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clip(text: string): string {
  return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX - 1).trimEnd()}…` : text;
}

export function toEvents(results: TavilyResult[]): TavilyEvent[] {
  return results.flatMap((r) => {
    const url = httpUrl(r.url);
    if (!url) return [];
    return [{
      title: r.title.trim() || "Untitled listing",
      url,
      date: r.published_date ?? undefined,
      snippet: clip(r.content.trim()),
    }];
  });
}

function evidenceFor(
  store: Store,
  body: TavilyRequest,
  results: TavilyResult[],
  events: TavilyEvent[],
  mode: Evidence["mode"],
  now: Date,
): Evidence {
  const relevance = results.length
    ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / results.length) * 100) / 100
    : undefined;
  const summary = events.length
    ? `Tavily found ${events.length} event ${events.length === 1 ? "listing" : "listings"} this week near ${store.addressLabel}.`
    : `Tavily found no event listings this week near ${store.addressLabel}.`;
  return {
    id: newId("ev_tv"),
    source: "tavily",
    endpoint: "/search",
    params: tavilyParams(body),
    summary,
    metrics: relevance === undefined ? {} : { relevance },
    entityIds: [],
    url: events[0]?.url,
    fetchedAt: now.toISOString(),
    mode,
  };
}

/**
 * Event listings this week near a store's corner. Goes through fetchJson (retry, timeout, record
 * and replay, fixture fallback). The Bearer key only leaves the server on a live call and never
 * enters the body, the recording key, the evidence or an error message.
 */
export async function eventsThisWeek(store: Store, opts: TavilyOptions = {}): Promise<EventsThisWeek> {
  const env = opts.env ?? serverEnv();
  const { run } = tavilyModeFor(env);
  const body = buildTavilyBody(store);
  const headers = run === "live" && env.TAVILY_API_KEY ? { authorization: `Bearer ${env.TAVILY_API_KEY}` } : undefined;

  const { data, mode } = await fetchJson<TavilyResponse>({
    provider: "tavily",
    method: "POST",
    url: TAVILY_SEARCH_URL,
    headers,
    body,
    mode: run,
    schema: TavilyResponse,
    fixture: () => tavilyFixture(store.id, body.query),
    timeoutMs: 15_000,
    recorder: opts.recorder,
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    random: opts.random,
  });

  const events = toEvents(data.results);
  const evidence = evidenceFor(store, body, data.results, events, mode, (opts.clock ?? (() => new Date()))());
  return { events, evidence };
}
