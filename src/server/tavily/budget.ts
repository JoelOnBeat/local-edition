import { z } from "zod";
import { HttpError } from "../http/errors";
import { createLogger } from "../log";
import { tavilyBudgetStub } from "../platform/adapters";
import type { TavilyBudgetStub } from "../platform/stubs";
import type { TavilyCache } from "./cache";

const log = createLogger("tavily-budget");

/**
 * Tavily credit budget (docs/CLOUDFLARE.md): ONE free key shared, so Local Edition has ONE global
 * ledger, not a per-workspace one (workspaces are unlimited, so a per-workspace cap caps nothing): a hard total of
 * 80 credits through 15 Dec and a daily slice of 10 (one full 8-store weekly build), reserved before every live call. On Workers the ledger is the
 * TavilyBudgetDO (atomic across isolates). Without that binding (dev, tests) it is the repo cache behind a
 * best-effort lock. If the Durable Object errors, the call is refused (`unavailable`): a second ledger that started
 * from zero would silently reset the cap.
 */

export const TOTAL_CREDIT_CAP = 80;
export const DAILY_CREDIT_SLICE = 10;
/** Kept as an alias: the daily allowance used to be per workspace. */
export const DAILY_CREDIT_CAP = DAILY_CREDIT_SLICE;
/** Credits per call (https://docs.tavily.com/documentation/api-credits). */
export const SEARCH_CREDITS = 1;
/** Basic extract: 1 credit per 5 URLs. */
export const extractCredits = (urls: number) => Math.ceil(urls / 5);
/** A 10-page basic crawl: 1 for mapping plus 2 for extracting 10 pages. */
export const CRAWL_CREDITS = 3;

const STATE_KEY = "tv:credits:global:v1";
const LOCK_NAME = "tv:credits:lock";
const STATE_TTL_SECONDS = 120 * 24 * 3600;
const LOCK_TTL_SECONDS = 10;
const LOCK_TRIES = 8;
const State = z.object({ total: z.number().int().nonnegative(), day: z.string(), dayUsed: z.number().int().nonnegative() });
type State = z.infer<typeof State>;

export type BudgetReason = "daily" | "total" | "scope" | "unavailable";

const MESSAGES: Record<BudgetReason, string> = {
  daily: "Live web search has used today's share of its credits. Using this week's saved events instead.",
  total: "Live web search has used all the credits set aside for this project. Using this week's saved events instead.",
  scope: "Live web search runs only for the weekly sample build. Using this week's saved events instead.",
  unavailable: "The web-search budget could not be checked, so no live search ran. Using this week's saved events instead.",
};

/** 429 `tavily_budget`: no live search for this call. Callers fall back to this week's saved events. */
export class TavilyBudgetError extends HttpError {
  constructor(readonly reason: BudgetReason, readonly used = 0, readonly wanted = 0, readonly cap = 0) {
    super(429, "tavily_budget", MESSAGES[reason]);
    this.name = "TavilyBudgetError";
  }
}

export interface CreditTicket {
  credits: number;
  /** The UTC day the credits came out of, so a refund returns them to the same slice. */
  day: string;
}

export interface CreditUsage {
  today: number;
  total: number;
  dailyCap: number;
  totalCap: number;
}

export interface CreditLedger {
  /** Takes `credits` from the global total and today's slice, or throws TavilyBudgetError. */
  reserve(credits: number): Promise<CreditTicket>;
  /** Gives credits back when the call failed before Tavily billed it. */
  refund(ticket: CreditTicket): Promise<void>;
  usage(): Promise<CreditUsage>;
}

export interface LedgerOptions {
  dailyCap?: number;
  totalCap?: number;
  /** The Durable Object; defaults to the TAVILY_BUDGET binding when there is one. `null` forces the repo ledger. */
  stub?: TavilyBudgetStub | null;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function durableLedger(stub: TavilyBudgetStub, totalCap: number, dailyCap: number): CreditLedger {
  return {
    async reserve(credits) {
      let res;
      try {
        res = await stub.reserve(credits, totalCap, dailyCap);
      } catch (e) {
        log.warn("tavily budget Durable Object unavailable; refusing the live call", { err: (e as Error)?.name });
        throw new TavilyBudgetError("unavailable");
      }
      if (!res.ok) throw new TavilyBudgetError(res.reason, res.reason === "total" ? res.total : res.today, credits, res.reason === "total" ? totalCap : dailyCap);
      return { credits, day: res.day };
    },
    refund: (t) => stub.refund(t.credits, t.day).catch((e) => log.warn("tavily refund failed", { err: (e as Error)?.name })),
    async usage() {
      const u = await stub.usage();
      return { today: u.today, total: u.total, dailyCap, totalCap };
    },
  };
}

const tails = new Map<string, Promise<unknown>>();
/** Runs `fn` after every earlier call with the same key in this isolate. */
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** Repo-backed ledger: one counter row, read-modify-write inside the in-isolate queue and the repo's best-effort lock. */
function repoLedger(cache: TavilyCache, clock: () => Date, totalCap: number, dailyCap: number): CreditLedger {
  const load = async (): Promise<State> => {
    const parsed = State.safeParse(await cache.get<unknown>(STATE_KEY));
    const today = dayOf(clock());
    const state = parsed.success ? parsed.data : { total: 0, day: today, dayUsed: 0 };
    return state.day === today ? state : { ...state, day: today, dayUsed: 0 };
  };
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> =>
    serial(STATE_KEY, async () => {
      if (!cache.acquireLock) return fn();
      let token: string | null = null;
      for (let i = 0; i < LOCK_TRIES && !token; i++) {
        token = await cache.acquireLock(LOCK_NAME, LOCK_TTL_SECONDS);
        if (!token) await new Promise((r) => setTimeout(r, 25 * (i + 1)));
      }
      // Never spend without the lock: a refused reservation costs one fallback, a double spend costs the key.
      if (!token) throw new TavilyBudgetError("unavailable");
      try {
        return await fn();
      } finally {
        await cache.releaseLock?.(LOCK_NAME, token).catch(() => undefined);
      }
    });

  return {
    reserve: (credits) =>
      exclusive(async () => {
        const state = await load();
        if (state.total + credits > totalCap) throw new TavilyBudgetError("total", state.total, credits, totalCap);
        if (state.dayUsed + credits > dailyCap) throw new TavilyBudgetError("daily", state.dayUsed, credits, dailyCap);
        await cache.put(STATE_KEY, { total: state.total + credits, day: state.day, dayUsed: state.dayUsed + credits }, STATE_TTL_SECONDS);
        return { credits, day: state.day };
      }),
    refund: (t) =>
      exclusive(async () => {
        const state = await load();
        const dayUsed = state.day === t.day ? Math.max(0, state.dayUsed - t.credits) : state.dayUsed;
        await cache.put(STATE_KEY, { total: Math.max(0, state.total - t.credits), day: state.day, dayUsed }, STATE_TTL_SECONDS);
      }),
    usage: async () => {
      const state = await load();
      return { today: state.dayUsed, total: state.total, dailyCap, totalCap };
    },
  };
}

/** The global ledger: the Durable Object when bound, else the repo cache with a best-effort lock. */
export function createLedger(cache: TavilyCache, clock: () => Date = () => new Date(), opts: LedgerOptions = {}): CreditLedger {
  const totalCap = opts.totalCap ?? TOTAL_CREDIT_CAP;
  const dailyCap = opts.dailyCap ?? DAILY_CREDIT_SLICE;
  const stub = opts.stub === undefined ? tavilyBudgetStub() : opts.stub;
  return stub ? durableLedger(stub, totalCap, dailyCap) : repoLedger(cache, clock, totalCap, dailyCap);
}

/** For /api/limits: credits spent by the whole app so far (the global counter). A workspace id, as older callers pass, is accepted and ignored. */
export async function tavilyCreditsUsed(cache: TavilyCache, workspaceId?: string): Promise<number> {
  void workspaceId;
  try {
    return (await createLedger(cache).usage()).total;
  } catch {
    return 0;
  }
}
