import type { Evidence, Store } from "@/contract";
import { newId } from "@/lib/ids";
import { tavilyFixture } from "./fixtures";
import { buildTavilyBody, TAVILY_SEARCH_URL, tavilyParams, type TavilyRequest } from "./request";
import { callTavily } from "./call";
import { cacheKey, softGet, softPut } from "./cache";
import { resolveRuntime, type TavilyOptions, type TavilyRuntime } from "./runtime";
import { isSampleSearch } from "./scope";
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
 * Event listings this week near a store's corner, from one search. It goes through `searchStore`, so a live run is
 * cached, in scope (the demo workspace's sample stores) and reserved against the global credit ledger; a run outside
 * that scope throws TavilyBudgetError (`tavily_budget`) and the caller uses this week's saved events. The Bearer key
 * only leaves the server on a live call and never enters the body, the recording key, the evidence or an error message.
 * The edition build uses `eventChain` (search, page read and triage); this is the plain search.
 */
export async function eventsThisWeek(store: Store, opts: TavilyOptions = {}): Promise<EventsThisWeek> {
  const rt = await resolveRuntime(opts);
  const search = await searchStore(store, rt, opts.city);
  if (!search) {
    // Read-only run and nothing saved: an honest empty result, never a spend.
    const body = buildTavilyBody(store, opts.city, rt.clock());
    return { events: [], evidence: evidenceFor(store, body, [], [], "cache", rt.clock()) };
  }
  const events = toEvents(search.data.results);
  return { events, evidence: evidenceFor(store, search.body, search.data.results, events, search.mode, rt.clock()) };
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
 * page loads). May throw TavilyBudgetError: out of scope (not the demo workspace's sample store), or the global
 * total or today's slice is spent.
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
    liveOk: rt.liveAllowed && isSampleSearch(store, city, rt.clock()),
    timeoutMs: 15_000,
  });
  if (mode === "live") await softPut(rt.cache, key, data);
  return { data, body, mode };
}
