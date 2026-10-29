import type { Store } from "@/contract";
import { SAMPLE_CHAIN_ID, SAMPLE_CITY, SAMPLE_STORES } from "../sample/chain";
import { DEMO_WORKSPACE_ID } from "../session";
import { buildTavilyBody } from "./request";

/**
 * Who may spend a live Tavily credit. The key is shared and `/api/limits` shows judges the counter, so
 * live search is reserved for what the weekly build needs: the demo workspace's UNMODIFIED sample stores and its chain
 * setup (the brand-voice crawl). Everything else (a visitor's workspace, a store a visitor added or renamed) reads saved
 * results only and falls back to "this week's saved events" with code `tavily_budget`. A visitor's unmodified sample
 * store searches the same query as the demo's, so it reads the same saved result: no credit, no loss.
 */

/** The workspace a chain belongs to, as far as live-search scope goes: the sample chain's own id is the demo's; any other is a visitor's. */
export function workspaceOfChain(chain: { id: string }): string {
  return chain.id === SAMPLE_CHAIN_ID ? DEMO_WORKSPACE_ID : chain.id;
}

export const isDemoWorkspace = (workspaceId: string | undefined): boolean => workspaceId === DEMO_WORKSPACE_ID;

/** The eight queries the weekly build sends (sample store name + sample city + the week's dates). */
export function sampleQueries(now: Date): Set<string> {
  return new Set(SAMPLE_STORES.map((s) => buildTavilyBody(s, SAMPLE_CITY.name, now).query));
}

/**
 * True when `query` is exactly one a sample store sends this week. A store the visitor renamed, moved to another city
 * or added builds a different query, so it is not a sample query. Compared on the query itself (not an id), because the
 * query is what costs the credit and the cache key is derived from it.
 */
export function isSampleQuery(query: string, now: Date): boolean {
  return sampleQueries(now).has(query);
}

/** Convenience for the chain: is this store's search (in this city) a sample query? */
export function isSampleSearch(store: Pick<Store, "name" | "addressLabel">, city: string | undefined, now: Date): boolean {
  return isSampleQuery(buildTavilyBody(store, city, now).query, now);
}
