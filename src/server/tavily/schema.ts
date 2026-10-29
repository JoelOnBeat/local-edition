import { z } from "zod";

/** Tavily /search: the response we accept (validated on every live, replayed or fixture call). */

export const TavilyResult = z.object({
  title: z.string(),
  url: z.string().min(1),
  content: z.string(),
  score: z.number(),
  // Tavily's estimate of the page date. Only present for some topics; null-tolerant.
  published_date: z.string().nullish(),
});
export type TavilyResult = z.infer<typeof TavilyResult>;

export const TavilyResponse = z.object({
  query: z.string(),
  results: z.array(TavilyResult),
});
export type TavilyResponse = z.infer<typeof TavilyResponse>;
