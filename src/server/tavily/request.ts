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

/** Body sent to Tavily. The key travels in the Authorization header, never in the body. */
export function buildTavilyBody(store: Pick<Store, "name" | "addressLabel">): TavilyRequest {
  return {
    query: `events this week near ${store.addressLabel}, ${store.name}, New York`,
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
