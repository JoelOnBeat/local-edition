import type { Chain, Evidence, Store } from "@/contract";
import { HttpError, UpstreamError } from "../http/errors";
import { createLogger } from "../log";
import { getTokenFactory } from "../tokenfactory/client";
import { TavilyBudgetError, extractCredits } from "./budget";
import { cacheKey, softGet, softPut } from "./cache";
import { chainEvidence, Snapshot, type TriagedEvent } from "./chain-evidence";
import { extractPages, type ExtractedPages } from "./extract";
import { buildTavilyBody } from "./request";
import { resolveRuntime, type TavilyOptions, type TavilyRuntime } from "./runtime";
import { httpUrl, searchStore, type StoreSearch } from "./search";
import { listCandidates, type Scored } from "./candidates";
import { failedTriage, triageCandidate, type StepRecord } from "./triage";

const log = createLogger("tavily-chain");

export type ChainFallback = "tavily_budget" | "cache_only" | "tavily_unavailable";
export type ChainChain = Pick<Chain, "name" | "category" | "brandVoice" | "city">;

export interface EventChainResult {
  storeId: string;
  /** Every candidate with its triage, kept ones first. */
  events: TriagedEvent[];
  /** Candidates Tavily returned ("found N") and those Lightning kept ("kept M"). */
  found: number;
  kept: number;
  /** Summary row first, then one row per kept event, then the page read. Empty when nothing was fetched. */
  evidence: Evidence[];
  /** Why there is nothing new: the workspace's day is spent, the run is read-only, or Tavily failed. */
  fallback: ChainFallback | null;
  /** Whether the batched extract supplied page text for this store. */
  extracted: boolean;
  /** One entry per Lightning call, for the run panel's `step_metrics` (role `check`, tool `triage`). */
  steps: StepRecord[];
}

export interface EventChainBatch {
  results: Map<string, EventChainResult>;
  /** Credits this batch spent live (0 for cached, replayed and fixture runs). */
  creditsUsed: number;
}

const RESULT_CAP = 6;
const SNIPPET_MAX = 500;
const TRIAGE_CONCURRENCY = 3;
const emptyResult = (storeId: string, fallback: ChainFallback | null): EventChainResult => ({
  storeId, events: [], found: 0, kept: 0, evidence: [], fallback, extracted: false, steps: [],
});

function candidatesOf(search: StoreSearch): Scored[] {
  const seen = new Set<string>();
  return [...search.data.results]
    .sort((a, b) => b.score - a.score)
    .flatMap((r) => {
      const url = httpUrl(r.url);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [{ title: r.title.trim() || "Untitled listing", url, snippet: r.content.replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX), pageText: null, score: r.score }];
    })
    .slice(0, RESULT_CAP);
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

interface Pending {
  store: Store;
  search: StoreSearch;
  chainKey: string;
  /** One entry per search result: the offline and fallback candidates, and the input of the listing call. */
  results: Scored[];
  /** The events to triage: listed from the pages by Lightning, or `results` when that call is unavailable. */
  candidates: Scored[];
  /** Set when the extracted page text was handed to the listing call. */
  extractedUrl: string | null;
  steps: StepRecord[];
  /** The listing call failed, so this store was triaged result by result; such a result is not saved. */
  degraded: boolean;
}

type Verdict = { kept: boolean; reason: string; title: string | null; venue: string | null; date: string | null };

/** Kept events first (soonest day first), then the dropped ones by Tavily's score. */
function assemble(p: Pending, verdicts: Verdict[], extractedUrl: string | null, now: Date): Snapshot {
  const events = p.candidates.map((c, i) => ({
    title: verdicts[i].title ?? c.title,
    url: c.url,
    venue: verdicts[i].venue,
    date: verdicts[i].date,
    snippet: c.snippet.slice(0, 280),
    score: c.score,
    triage: { kept: verdicts[i].kept, reason: verdicts[i].reason.slice(0, 300) },
  }));
  events.sort((a, b) => {
    if (a.triage.kept !== b.triage.kept) return a.triage.kept ? -1 : 1;
    return a.triage.kept ? (a.date ?? "").localeCompare(b.date ?? "") : b.score - a.score;
  });
  const scores = p.search.data.results.map((r) => r.score);
  return {
    query: p.search.body.query,
    found: events.length,
    kept: events.filter((e) => e.triage.kept).length,
    avgScore: scores.length ? Math.round((scores.reduce((sum, x) => sum + x, 0) / scores.length) * 100) / 100 : null,
    extractedUrl,
    fetchedAt: now.toISOString(),
    events,
  };
}

function fromSnapshot(store: Store, snap: Snapshot, body: ReturnType<typeof buildTavilyBody>, mode: Evidence["mode"], steps: StepRecord[], fallback: ChainFallback | null): EventChainResult {
  const { evidence, events } = chainEvidence({ store, body, snap, mode });
  return { storeId: store.id, events, found: snap.found, kept: snap.kept, evidence, fallback, extracted: snap.extractedUrl !== null, steps };
}

/**
 * The Tavily chain for a set of stores (one build): a basic search per store, then ONE batched extract of the
 * top URL of each store, then Lightning lists the individual events in those pages and triages each one. Results are saved for 7 days under the hash of
 * the normalised query, so a second build, a regenerate or another visitor reuses them without a credit.
 * Never throws for a budget or upstream problem: the store gets an empty result and a `fallback` code.
 */
export async function prefetchEventChains(stores: Store[], chain: ChainChain, opts: TavilyOptions = {}): Promise<EventChainBatch> {
  const rt = await resolveRuntime(opts);
  const results = new Map<string, EventChainResult>();
  const pending: Pending[] = [];
  let credits = 0;
  let budgetHit = false;

  for (const store of stores) {
    const body = buildTavilyBody(store, chain.city.name, rt.clock());
    const chainKey = await cacheKey("chain", body.query, body.time_range);
    const saved = await softGet(rt.cache, chainKey, (raw) => {
      const parsed = Snapshot.safeParse(raw);
      return parsed.success ? parsed.data : null;
    });
    if (saved) {
      results.set(store.id, fromSnapshot(store, saved, body, "cache", [], null));
      continue;
    }
    if (budgetHit) {
      results.set(store.id, emptyResult(store.id, "tavily_budget"));
      continue;
    }
    try {
      const search = await searchStore(store, rt, chain.city.name);
      if (!search) {
        results.set(store.id, emptyResult(store.id, "cache_only"));
        continue;
      }
      if (search.mode === "live") credits += 1;
      const hits = candidatesOf(search);
      pending.push({ store, search, chainKey, results: hits, candidates: hits, extractedUrl: null, steps: [], degraded: false });
    } catch (e) {
      if (e instanceof TavilyBudgetError) budgetHit = true;
      else if (!(e instanceof UpstreamError)) throw e;
      log.warn("search skipped", { store: store.id, code: e instanceof HttpError ? e.code : (e as UpstreamError).code });
      results.set(store.id, emptyResult(store.id, e instanceof TavilyBudgetError ? "tavily_budget" : "tavily_unavailable"));
    }
  }

  const extract = await readTopPages(pending, rt);
  if (extract?.mode === "live" && extract.fetched.length) credits += extractCredits(extract.fetched.length);

  const tf = pending.length ? (opts.tf ?? getTokenFactory()) : null;
  const ctxOf = (p: Pending) => ({
    store: p.store,
    chain: { name: chain.name, category: chain.category, brandVoice: chain.brandVoice, city: chain.city.name },
    now: rt.clock(),
  });

  // Stage 1: one Lightning call per store lists the individual events inside the roundup pages.
  await pool(pending, TRIAGE_CONCURRENCY, async (p) => {
    const top = p.results[0];
    const pageText = top ? (extract?.pages.get(top.url) ?? null) : null;
    p.extractedUrl = pageText ? top.url : null;
    // Fallback and offline shape: one candidate per search result, the top one carrying the extracted page.
    const perResult = p.results.map((c, i) => (i === 0 ? { ...c, pageText } : c));
    if (!top) return;
    try {
      const listed = await listCandidates(tf!, p.results, pageText, ctxOf(p));
      if (listed) {
        p.candidates = listed.candidates;
        p.steps.push(listed.step);
      } else p.candidates = perResult;
    } catch (e) {
      log.warn("event listing failed; triaging each result", { store: p.store.id, err: (e as Error).name });
      p.candidates = perResult;
      p.degraded = true;
    }
  });

  // Stage 2: one triage call per candidate event.
  const jobs = pending.flatMap((p, pi) => p.candidates.map((_, ci) => ({ pi, ci })));
  const outcomes = await pool(jobs, TRIAGE_CONCURRENCY, async ({ pi, ci }) => {
    const p = pending[pi];
    const c = p.candidates[ci];
    try {
      return { ...(await triageCandidate(tf!, c, ctxOf(p))), failed: false };
    } catch (e) {
      log.warn("triage failed", { store: p.store.id, err: (e as Error).name });
      return { result: failedTriage(c, e), step: null, failed: true };
    }
  });

  for (const [pi, p] of pending.entries()) {
    const mine = jobs.map((j, i) => ({ j, o: outcomes[i] })).filter((x) => x.j.pi === pi).sort((a, b) => a.j.ci - b.j.ci);
    const snap = assemble(p, mine.map((x) => x.o.result), p.extractedUrl, rt.clock());
    // A result with a failed model call is not saved: the next build retries it instead of repeating "not checked".
    if (rt.run === "live" && !p.degraded && !mine.some((x) => x.o.failed)) await softPut(rt.cache, p.chainKey, snap);
    const steps = [...p.steps, ...mine.flatMap((x) => (x.o.step ? [x.o.step] : []))];
    results.set(p.store.id, fromSnapshot(p.store, snap, p.search.body, p.search.mode, steps, null));
  }

  return { results, creditsUsed: credits };
}

async function readTopPages(pending: Pending[], rt: TavilyRuntime): Promise<ExtractedPages | null> {
  const urls = pending.flatMap((p) => (p.results[0] ? [p.results[0].url] : []));
  if (urls.length === 0) return null;
  try {
    return await extractPages(urls, rt);
  } catch (e) {
    if (e instanceof TavilyBudgetError || e instanceof UpstreamError) {
      log.warn("extract skipped; triage uses search snippets", { code: (e as { code: string }).code });
      return null;
    }
    throw e;
  }
}

/** One store's chain. Costs 2 credits live (search + extract); a build should call `prefetchEventChains` once instead. */
export async function eventChain(store: Store, chain: ChainChain, opts: TavilyOptions = {}): Promise<EventChainResult & { creditsUsed: number }> {
  const batch = await prefetchEventChains([store], chain, opts);
  return { ...batch.results.get(store.id)!, creditsUsed: batch.creditsUsed };
}
