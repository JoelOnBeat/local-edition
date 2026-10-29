import type { Evidence, Store } from "@/contract";
import { serverEnv } from "@/lib/env";
import { newId } from "@/lib/ids";
import { fetchJson } from "../http/fetch-json";
import { tavilyFixture } from "./fixtures";
import { buildTavilyBody, TAVILY_SEARCH_URL, tavilyParams, type TavilyRequest } from "./request";
import { tavilyModeFor } from "./mode";
import { callTavily } from "./call";
import { cacheKey, softGet, softPut } from "./cache";
import type { TavilyOptions, TavilyRuntime } from "./runtime";
import { SEARCH_CREDITS } from "./budget";
import { TavilyResponse, type TavilyResult } from "./schema";

export type { TavilyOptions } from "./runtime";

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

export function evidenceFor(
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
  const clock = opts.clock ?? (() => new Date());
  const body = buildTavilyBody(store, opts.city, clock());
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
  const evidence = evidenceFor(store, body, data.results, events, mode, clock());
  return { events, evidence };
}


export interface StoreSearch {
  data: TavilyResponse;
  body: TavilyRequest;
  /** `cache` when this week's saved search was reused (no credit spent). */
  mode: Evidence["mode"];
}

/**
 * The chain's search step: one basic search per store, saved for 7 days under a hash of the normalised
 * query and time range. Returns null on a miss when the runtime is read-only (`cacheOnly`: regenerate,
 * page loads). May throw TavilyBudgetError (live, workspace's day spent).
 */
export async function searchStore(store: Store, rt: TavilyRuntime, city?: string): Promise<StoreSearch | null> {
  const body = buildTavilyBody(store, city, rt.clock());
  const key = await cacheKey("search", body.query, body.time_range);
  const hit = await softGet(rt.cache, key, (raw) => {
    const parsed = TavilyResponse.safeParse(raw);
    return parsed.success ? parsed.data : null;
  });
  if (hit) return { data: hit, body, mode: "cache" };
  if (rt.cacheOnly && rt.run === "live") return null;

  const { data, mode } = await callTavily<TavilyResponse>(rt, {
    url: TAVILY_SEARCH_URL,
    body,
    schema: TavilyResponse,
    fixture: () => tavilyFixture(store.id, body.query),
    credits: SEARCH_CREDITS,
    timeoutMs: 15_000,
  });
  if (mode === "live") await softPut(rt.cache, key, data);
  return { data, body, mode };
}
