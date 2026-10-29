import { z } from "zod";
import { HttpError } from "../http/errors";
import type { TavilyCache } from "./cache";

/**
 * Tavily credit budget (docs/CLOUDFLARE.md): one free key, shared. Per workspace, at most
 * 10 credits a day. The counters live in the shared cache (KV on Workers), so every isolate sees them and
 * /api/limits can read the total. KV has no compare-and-swap: inside one isolate the counter is exact
 * (calls are serialised); across isolates a burst can slip a credit or two past the cap.
 */

export const DAILY_CREDIT_CAP = 10;
/** Credits per call (https://docs.tavily.com/documentation/api-credits). */
export const SEARCH_CREDITS = 1;
/** Basic extract: 1 credit per 5 URLs. */
export const extractCredits = (urls: number) => Math.ceil(urls / 5);
/** A 10-page basic crawl: 1 for mapping plus 2 for extracting 10 pages. */
export const CRAWL_CREDITS = 3;

const DAY_TTL_SECONDS = 2 * 24 * 3600;
const TOTAL_TTL_SECONDS = 120 * 24 * 3600;
const Counter = z.object({ used: z.number().int().nonnegative() });

/** 429 `tavily_budget`: today's allowance is spent. Callers fall back to this week's saved events. */
export class TavilyBudgetError extends HttpError {
  constructor(readonly used: number, readonly wanted: number, readonly cap: number) {
    super(429, "tavily_budget", `This workspace has used ${used} of its ${cap} daily web-search credits. Using this week's saved events instead.`);
    this.name = "TavilyBudgetError";
  }
}

export interface CreditLedger {
  /** Takes `credits` for the workspace today or throws TavilyBudgetError. */
  reserve(workspaceId: string, credits: number): Promise<void>;
  /** Gives credits back when the call failed before Tavily billed it. */
  refund(workspaceId: string, credits: number): Promise<void>;
  used(workspaceId: string): Promise<{ today: number; total: number; capPerDay: number }>;
}

const tails = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function createLedger(cache: TavilyCache, clock: () => Date = () => new Date(), cap = DAILY_CREDIT_CAP): CreditLedger {
  const dayKey = (ws: string) => `tv:credits:day:${ws}:${dayOf(clock())}`;
  const totalKey = (ws: string) => `tv:credits:total:${ws}`;
  const read = async (key: string) => {
    const raw = await cache.get<unknown>(key);
    const parsed = Counter.safeParse(raw);
    return parsed.success ? parsed.data.used : 0;
  };
  const write = (key: string, used: number, ttl: number) => cache.put(key, { used }, ttl);

  return {
    reserve: (ws, credits) =>
      serial(`tv:${ws}`, async () => {
        const today = await read(dayKey(ws));
        if (today + credits > cap) throw new TavilyBudgetError(today, credits, cap);
        await write(dayKey(ws), today + credits, DAY_TTL_SECONDS);
        await write(totalKey(ws), (await read(totalKey(ws))) + credits, TOTAL_TTL_SECONDS);
      }),
    refund: (ws, credits) =>
      serial(`tv:${ws}`, async () => {
        await write(dayKey(ws), Math.max(0, (await read(dayKey(ws))) - credits), DAY_TTL_SECONDS);
        await write(totalKey(ws), Math.max(0, (await read(totalKey(ws))) - credits), TOTAL_TTL_SECONDS);
      }),
    used: async (ws) => ({ today: await read(dayKey(ws)), total: await read(totalKey(ws)), capPerDay: cap }),
  };
}

/** For /api/limits: credits this workspace has spent since its counter began (about 4 months of memory). */
export async function tavilyCreditsUsed(cache: TavilyCache, workspaceId: string): Promise<number> {
  return (await createLedger(cache).used(workspaceId)).total;
}
