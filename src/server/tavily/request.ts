import { z } from "zod";
import type { Store } from "@/contract";

/** The one search we make per store. Fixed parameters: the query is the only varying input. */

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const TAVILY_MAX_RESULTS = 6;

export const TavilyRequest = z.object({
  query: z.string().min(1).max(400),
  topic: z.literal("general"),
  time_range: z.literal("week"),
  max_results: z.literal(TAVILY_MAX_RESULTS),
  search_depth: z.literal("basic"),
});
export type TavilyRequest = z.infer<typeof TavilyRequest>;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_MS = 86_400_000;

const dayLabel = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

/** "October 26 to November 1 2026": Monday to Sunday of the week holding `now`. Stable all week, so recordings replay. */
export function weekPhrase(now: Date): string {
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - sinceMonday * DAY_MS);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  return `${dayLabel(monday)} to ${dayLabel(sunday)} ${sunday.getUTCFullYear()}`;
}

/**
 * Body sent to Tavily. The key travels in the Authorization header, never in the body. `city` is the
 * chain's city (a London chain must not search New York). Live check, 29 Oct 2026: the neighbourhood
 * (store name), city and the week's dates return event roundups scoring 0.6 to 0.9; adding the street
 * corner pulled in street-fair directories (0.2 to 0.5), so the corner stays out of the query and in the
 * evidence summary only.
 */
export function buildTavilyBody(store: Pick<Store, "name" | "addressLabel">, city?: string, now?: Date): TavilyRequest {
  const place = [store.name, city?.trim()].filter(Boolean).join(" ") || store.addressLabel;
  return {
    query: `${place} events things to do this week${now ? ` ${weekPhrase(now)}` : ""}`,
    topic: "general",
    time_range: "week",
    max_results: TAVILY_MAX_RESULTS,
    search_depth: "basic",
  };
}

/** Evidence params: the request's non-secret parameters as strings. */
export function tavilyParams(body: TavilyRequest): Record<string, string> {
  return {
    query: body.query,
    topic: body.topic,
    time_range: body.time_range,
    max_results: String(body.max_results),
    search_depth: body.search_depth,
  };
}
