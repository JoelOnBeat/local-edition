import { UpstreamError } from "../http/errors";
import { createLogger } from "../log";
import { platformEnvSync } from "../platform/env";
import type { TavilyBudgetStub } from "../platform/stubs";

const log = createLogger("qloo-ledger");

/**
 * The hard Qloo call ledger (owner, 30 Oct 2026). The hackathon key's credits are unknown and shared, so the
 * whole app may make at most QLOO_TOTAL_CAP live calls through 15 Dec and QLOO_DAILY_SLICE a day, counted across every
 * workspace and isolate and reserved BEFORE each call. A reservation is never refunded: Qloo may have billed a call that then
 * failed on our side, and a cap that can be argued down is not a cap. Replay and fixture runs never reach the ledger.
 *
 * It reuses the Tavily ledger's Durable Object class (atomic "check both caps, then take") as a second, separate instance
 * named "qloo", so no new Durable Object migration is needed. Without the binding (next dev, tests) a per-process counter applies.
 */
export const QLOO_TOTAL_CAP = 300;
export const QLOO_DAILY_SLICE = 40;
/** Responses are saved for two weeks: editions are built once a week and judges read stored ones. */
export const QLOO_RESPONSE_TTL_SECONDS = 14 * 24 * 3600;

export type QlooBudgetReason = "total" | "daily" | "unavailable";

export interface QlooUsage {
  total: number;
  today: number;
  totalCap: number;
  dailyCap: number;
}

export interface QlooLedger {
  /** Takes `calls` from the global total and today's slice, or throws the `spend_cap` UpstreamError. */
  reserve(calls?: number): Promise<void>;
  usage(): Promise<QlooUsage>;
}

const MESSAGES: Record<QlooBudgetReason, string> = {
  total: "Live Qloo calls have used all the credits set aside for this project. Using the saved taste data instead.",
  daily: "Live Qloo calls have used today's share of their credits. Using the saved taste data instead.",
  unavailable: "The Qloo call budget could not be checked, so no live call was made. Using the saved taste data instead.",
};

/** The error every refused live call raises. Qloo's callers already degrade on an UpstreamError and keep their saved data. */
export function qlooBudgetError(reason: QlooBudgetReason): UpstreamError {
  return new UpstreamError("spend_cap", "qloo", MESSAGES[reason], { status: 429 });
}

/** Under `next dev` wrangler lists the Durable Object bindings but cannot run them, so dev uses the per-process counter. */
function boundStub(): TavilyBudgetStub | null {
  if (process.env.NODE_ENV === "development") return null;
  const ns = platformEnvSync()?.TAVILY_BUDGET;
  return ns ? ns.get(ns.idFromName("qloo")) : null;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

interface LedgerOptions {
  totalCap?: number;
  dailyCap?: number;
  clock?: () => Date;
  /** Tests: a stub in place of the Durable Object. `null` forces the per-process counter. */
  stub?: TavilyBudgetStub | null;
}

export function createQlooLedger(opts: LedgerOptions = {}): QlooLedger {
  const totalCap = opts.totalCap ?? QLOO_TOTAL_CAP;
  const dailyCap = opts.dailyCap ?? QLOO_DAILY_SLICE;
  const clock = opts.clock ?? (() => new Date());
  const stub = opts.stub === undefined ? boundStub() : opts.stub;
  if (stub) {
    return {
      async reserve(calls = 1) {
        let res;
        try {
          res = await stub.reserve(calls, totalCap, dailyCap);
        } catch (e) {
          log.warn("qloo ledger unavailable; refusing the live call", { err: (e as Error)?.name });
          throw qlooBudgetError("unavailable");
        }
        if (!res.ok) throw qlooBudgetError(res.reason);
      },
      async usage() {
        const u = await stub.usage();
        return { total: u.total, today: u.today, totalCap, dailyCap };
      },
    };
  }
  return memoryQlooLedger(totalCap, dailyCap, clock);
}

const processCounters = new Map<string, { total: number; day: string; today: number }>();

function memoryQlooLedger(totalCap: number, dailyCap: number, clock: () => Date): QlooLedger {
  const state = () => {
    const key = `${totalCap}:${dailyCap}`;
    const s = processCounters.get(key) ?? { total: 0, day: dayOf(clock()), today: 0 };
    if (s.day !== dayOf(clock())) Object.assign(s, { day: dayOf(clock()), today: 0 });
    processCounters.set(key, s);
    return s;
  };
  return {
    async reserve(calls = 1) {
      const s = state();
      if (s.total + calls > totalCap) throw qlooBudgetError("total");
      if (s.today + calls > dailyCap) throw qlooBudgetError("daily");
      s.total += calls;
      s.today += calls;
    },
    async usage() {
      const s = state();
      return { total: s.total, today: s.today, totalCap, dailyCap };
    },
  };
}

/** For /api/limits: live Qloo calls the whole app has made so far (0 when the ledger cannot be read). */
export async function qlooCallsUsed(ledger: QlooLedger = createQlooLedger()): Promise<QlooUsage | null> {
  try {
    return await ledger.usage();
  } catch {
    return null;
  }
}

/** Tests only: forget the per-process counters. */
export function resetProcessQlooLedger(): void {
  processCounters.clear();
}
