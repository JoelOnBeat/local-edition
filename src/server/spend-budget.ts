import { serverEnv } from "@/lib/env";
import { HttpError, RetryAfterError, UpstreamError } from "./http/errors";
import { createLogger } from "./log";
import { serial } from "./serial";
import { getRepo } from "./store";
import type { Repo } from "./store";
import { tokenFactoryMeter } from "./tokenfactory/spend";

const log = createLogger("spend-budget");

/**
 * Who may use how much of the shared Token Factory cap (`SPEND_CAP_USD`, default $5, enforced by the meter).
 * The cap alone lets one judge's burst of builds spend it all for everyone, so a visitor's request is admitted only
 * while it is inside three more limits, all charged at the route BEFORE the model is called:
 *  - a per-workspace sub-budget, $0.40 for the workspace's lifetime;
 *  - a per-network daily dollar cap, $0.80 (the IP is hashed; IPv6 is keyed by its /64);
 *  - a reserved floor, $1.50 of the cap that visitors can never use: the demo workspace and the weekly cron (neither
 *    is charged here) always have room to build.
 * The charge is a pessimistic estimate per action (`ADMISSION_USD`: one 8-store build is about $0.09 and pessimistically
 * $0.20, docs/CLOUDFLARE.md), not the metered amount, because a streamed build or a Workflow step has no request left
 * to attribute its real spend to. The meter still enforces the true total. Counters live in the repo cache (KV on
 * Workers): exact inside one isolate, best effort across isolates (a burst can slip a request or two past a sub-budget;
 * the global cap and the floor are the hard limits).
 * Applies only when Token Factory runs live: replay and fixture runs cost nothing.
 */

export const WORKSPACE_BUDGET_USD = 0.4;
export const IP_DAILY_BUDGET_USD = 0.8;
export const DEMO_FLOOR_USD = 1.5;

/** Pessimistic dollars per admitted action. */
export const ADMISSION_USD = { build: 0.2, regenerate: 0.015, card: 0.005, edit: 0.002 } as const;
export type AdmissionAction = keyof typeof ADMISSION_USD;
/** Routes wrapped by `ipLimited` that call a model but resolve the workspace later: charged to the network only. */
export const ROUTE_ADMISSION_USD: Readonly<Record<string, number>> = { "menu-read": 0.02, "brand-voice": 0.01 };

const WORKSPACE_TTL_SECONDS = 31 * 24 * 3600;
const IP_TTL_SECONDS = 2 * 24 * 3600;
/** Dollars to the micro-dollar, so 40 charges of $0.02 add up to exactly $0.80 and not $0.8000000000000002. */
const usd6 = (n: number) => Math.round(n * 1e6) / 1e6;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const DAY_MS = 24 * 3600 * 1000;
/** When the network's daily counter starts over: the next 00:00 UTC (the counter is keyed by UTC date). */
export const nextBudgetReset = (now: number): number => (Math.floor(now / DAY_MS) + 1) * DAY_MS;
const clock = (ms: number, timeZone: string) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

/** "This network has used its model budget for today. It resets at 08:00 Kuala Lumpur time (00:00 UTC, 20:00 New York), in 5 h 12 min." */
export function ipBudgetMessage(now: number): string {
  const reset = nextBudgetReset(now);
  const mins = Math.max(1, Math.ceil((reset - now) / 60_000));
  const left = mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min` : `${mins} min`;
  return `This network has used its model budget for today. It resets at ${clock(reset, "Asia/Kuala_Lumpur")} Kuala Lumpur time (${clock(reset, "UTC")} UTC, ${clock(reset, "America/New_York")} New York), in ${left}.`;
}

interface Counter {
  usd: number;
}

export interface BudgetCharge {
  /** The visitor workspace; absent for a charge made before the cookie is resolved. */
  workspaceId?: string;
  /** Hashed network key (`ipHash`). */
  ipKey: string;
  usd: number;
}

export interface BudgetOptions {
  repo?: Repo;
  now?: number;
  capUsd?: number;
  /** Spent so far according to the meter (test seam). */
  spentUsd?: () => Promise<number>;
  /** Run the check even when Token Factory is not live (tests). */
  force?: boolean;
}

/** True when model calls cost real money, so the sub-budgets mean something. */
export function budgetsActive(): boolean {
  const env = serverEnv();
  return env.TF_MODE === "live" && Boolean(env.NEBIUS_API_KEY);
}

const read = async (repo: Repo, key: string): Promise<number> => {
  const row = await repo.cacheGet<Counter>(key);
  return row && typeof row.usd === "number" && row.usd >= 0 ? row.usd : 0;
};

async function meterSpent(): Promise<number> {
  try {
    return (await tokenFactoryMeter().totals()).usd;
  } catch {
    throw new HttpError(503, "spend_unavailable", "The model spend meter is unavailable, so no model call was made. Try again in a moment.");
  }
}

/**
 * Admits or refuses one visitor action. Throws 402 `spend_cap` (the shared budget left for visitors is used up),
 * 429 `workspace_budget` or 429 `ip_budget`; nothing is charged when it throws.
 */
export async function chargeSpendBudget(charge: BudgetCharge, opts: BudgetOptions = {}): Promise<void> {
  if (!opts.force && !budgetsActive()) return;
  const repo = opts.repo ?? (await getRepo());
  const now = opts.now ?? Date.now();
  const cap = opts.capUsd ?? serverEnv().SPEND_CAP_USD;

  const spent = await (opts.spentUsd ?? meterSpent)();
  if (usd6(spent + charge.usd) > Math.max(0, usd6(cap - DEMO_FLOOR_USD))) {
    log.warn("visitor budget ceiling reached", { spentUsd: spent });
    throw new UpstreamError("spend_cap", "tokenfactory", "The shared model budget for visitors is used up. The weekly sample editions stay available.");
  }

  const ipKey = `sb:ip:${charge.ipKey}:${dayOf(now)}`;
  const wsKey = charge.workspaceId ? `sb:ws:${charge.workspaceId}` : null;
  await serial(ipKey, () =>
    serial(wsKey ?? ipKey + ":none", async () => {
      const ipSpent = await read(repo, ipKey);
      const wsSpent = wsKey ? await read(repo, wsKey) : 0;
      if (wsKey && usd6(wsSpent + charge.usd) > WORKSPACE_BUDGET_USD) {
        throw new HttpError(429, "workspace_budget", "This workspace has used its share of the model budget. The sample editions stay available.");
      }
      if (usd6(ipSpent + charge.usd) > IP_DAILY_BUDGET_USD) {
        throw new RetryAfterError(429, "ip_budget", ipBudgetMessage(now), (nextBudgetReset(now) - now) / 1000);
      }
      await repo.cachePut<Counter>(ipKey, { usd: usd6(ipSpent + charge.usd) }, IP_TTL_SECONDS);
      if (wsKey) await repo.cachePut<Counter>(wsKey, { usd: usd6(wsSpent + charge.usd) }, WORKSPACE_TTL_SECONDS);
    }),
  );
}
