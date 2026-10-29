import { z } from "zod";
import { callTavily } from "./call";
import { cacheKey, softGet, softPut } from "./cache";
import { extractCredits } from "./budget";
import type { TavilyRuntime } from "./runtime";

/** Tavily /extract: page text for the few URLs worth reading in full. One batched call per build. */

export const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
/** What one page may feed a model: a roundup page is long and only its top matters for a tie-in. */
export const PAGE_TEXT_MAX = 4000;

const ExtractRequest = z.object({
  urls: z.array(z.string().min(1)).min(1).max(20),
  extract_depth: z.literal("basic"),
  format: z.literal("text"),
});

export const ExtractResponse = z.looseObject({
  results: z.array(z.looseObject({ url: z.string().min(1), raw_content: z.string().nullish() })),
  failed_results: z.array(z.looseObject({ url: z.string().min(1) })).nullish(),
});
export type ExtractResponse = z.infer<typeof ExtractResponse>;

const SavedPage = z.object({ text: z.string() });

export interface ExtractedPages {
  /** url -> trimmed page text, for every URL that returned any. */
  pages: Map<string, string>;
  /** Mode of the live or replayed call; `cache` when every page came from the saved copies. */
  mode: "live" | "replay" | "fixture" | "cache";
  /** URLs that went out in the call (empty when everything was saved or the runtime is read-only). */
  fetched: string[];
}

const clipText = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, PAGE_TEXT_MAX);

/**
 * Reads `urls` (callers pass at most one per store) in ONE extract call, after reusing every page
 * saved in the last 7 days. May throw TavilyBudgetError; the caller then triages on the search snippets.
 */
export async function extractPages(urls: string[], rt: TavilyRuntime): Promise<ExtractedPages> {
  const unique = [...new Set(urls)];
  const pages = new Map<string, string>();
  const missing: { url: string; key: string }[] = [];
  for (const url of unique) {
    const key = await cacheKey("extract", url, "none");
    const hit = await softGet(rt.cache, key, (raw) => {
      const parsed = SavedPage.safeParse(raw);
      return parsed.success ? parsed.data.text : null;
    });
    if (hit !== null) pages.set(url, hit);
    else missing.push({ url, key });
  }
  const savedMode = pages.size ? "cache" : undefined;
  if (missing.length === 0 || (rt.cacheOnly && rt.run === "live")) {
    return { pages, mode: savedMode ?? rt.run, fetched: [] };
  }

  const body = ExtractRequest.parse({ urls: missing.map((m) => m.url), extract_depth: "basic", format: "text" });
  const { data, mode } = await callTavily<ExtractResponse>(rt, {
    url: TAVILY_EXTRACT_URL,
    body,
    schema: ExtractResponse,
    fixture: () => ({ results: [], failed_results: [] }),
    credits: extractCredits(missing.length),
    timeoutMs: 25_000,
  });
  for (const row of data.results) {
    const text = clipText(row.raw_content ?? "");
    if (!text) continue;
    pages.set(row.url, text);
    const hit = missing.find((m) => m.url === row.url);
    if (hit && mode === "live") await softPut(rt.cache, hit.key, { text });
  }
  return { pages, mode, fetched: missing.map((m) => m.url) };
}
