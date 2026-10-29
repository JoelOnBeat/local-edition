import { platformEnvSync } from "./env";
import type { BuildLockStub, SpendMeterStub, TavilyBudgetStub } from "./stubs";

/**
 * Under `next dev` wrangler's platform proxy lists the Durable Object bindings but cannot run them ("these will
 * not work in local development"), so dev goes straight to the repo-backed fallbacks instead of failing a call per request.
 */
const bound = () => (process.env.NODE_ENV === "development" ? null : platformEnvSync());

/** The one global spend ledger Durable Object, or null when SPEND_METER is not bound (dev, tests). */
export function spendMeterStub(): SpendMeterStub | null {
  const ns = bound()?.SPEND_METER;
  return ns ? ns.get(ns.idFromName("global")) : null;
}

/** The workspace's build-lock Durable Object, or null when BUILD_LOCK is not bound. */
export function buildLockStub(workspaceId: string): BuildLockStub | null {
  const ns = bound()?.BUILD_LOCK;
  return ns ? ns.get(ns.idFromName(`build:${workspaceId}`)) : null;
}

/** The one global Tavily credit ledger Durable Object, or null when TAVILY_BUDGET is not bound (dev, tests). */
export function tavilyBudgetStub(): TavilyBudgetStub | null {
  const ns = bound()?.TAVILY_BUDGET;
  return ns ? ns.get(ns.idFromName("global")) : null;
}
