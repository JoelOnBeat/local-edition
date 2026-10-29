import { z } from "zod";
import { callTavily } from "./call";
import { CRAWL_CREDITS } from "./budget";
import type { TavilyRuntime } from "./runtime";

/** Tavily /crawl: ten pages of the chain's own site, once per chain, for the brand-voice lines. */

export const TAVILY_CRAWL_URL = "https://api.tavily.com/crawl";
export const CRAWL_PAGE_LIMIT = 10;
/** Per page: enough to hear the voice, short enough that ten pages fit one Lightning call. */
export const CRAWL_PAGE_TEXT_MAX = 1800;

export const CrawlRequest = z.object({
  url: z.string().min(1).max(2000),
  limit: z.literal(CRAWL_PAGE_LIMIT),
  max_depth: z.literal(1),
  extract_depth: z.literal("basic"),
  format: z.literal("text"),
});
export type CrawlRequest = z.infer<typeof CrawlRequest>;

export const CrawlResponse = z.looseObject({
  base_url: z.string().nullish(),
  results: z.array(z.looseObject({ url: z.string().min(1), raw_content: z.string().nullish() })),
});
export type CrawlResponse = z.infer<typeof CrawlResponse>;

export interface CrawledPage {
  url: string;
  text: string;
}

export interface CrawlOutcome {
  pages: CrawledPage[];
  mode: "live" | "replay" | "fixture";
}

/** Offline stand-in: a one-page "site" so fixture mode still shows the flow. Clearly synthetic. */
function crawlFixture(url: string): CrawlResponse {
  return {
    base_url: url,
    results: [{
      url,
      raw_content:
        "Sample site text. We are a neighbourhood coffee house. We keep things plain and warm. " +
        "Come in, say hello, and we will remember your order. No fuss, no hype, just good coffee made by people who live nearby.",
    }],
  };
}

/** One basic crawl, 10 pages at most. Costs 3 credits live; throws TavilyBudgetError when the day is spent. */
export async function crawlSite(url: string, rt: TavilyRuntime): Promise<CrawlOutcome> {
  const body = CrawlRequest.parse({ url, limit: CRAWL_PAGE_LIMIT, max_depth: 1, extract_depth: "basic", format: "text" });
  const { data, mode } = await callTavily<CrawlResponse>(rt, {
    url: TAVILY_CRAWL_URL,
    body,
    schema: CrawlResponse,
    fixture: () => crawlFixture(url),
    credits: CRAWL_CREDITS,
    timeoutMs: 60_000,
  });
  const pages = data.results
    .map((r) => ({ url: r.url, text: (r.raw_content ?? "").replace(/\s+/g, " ").trim().slice(0, CRAWL_PAGE_TEXT_MAX) }))
    .filter((p) => p.text.length >= 40)
    .slice(0, CRAWL_PAGE_LIMIT);
  return { pages, mode };
}
