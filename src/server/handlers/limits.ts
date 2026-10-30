import { LimitsResponse, routes, type BudgetUsage, type Edition, type EditionItemKind, type Store } from "@/contract";
import { withRoute } from "../http/api";
import { rateLimitRows } from "../limits-table";
import { qlooCallsUsed } from "../qloo/ledger";
import { peekWorkspace } from "../session";
import { DEMO_FLOOR_USD, IP_DAILY_BUDGET_USD, WORKSPACE_BUDGET_USD } from "../spend-budget";
import { getRepo } from "../store";
import { DAILY_CREDIT_SLICE, TOTAL_CREDIT_CAP, createLedger } from "../tavily/budget";
import { cacheOfRepo } from "../tavily/cache";
import { readDropped, readEval, readMetricsTotals } from "./proof-ledger";

/**
 * GET /api/limits: what this system could not do, from stored data only. Cookie-scoped (the blocks and the coverage
 * gaps are read from the visitor's own editions); the counters and rates are system-wide. No model call.
 *
 * Honesty rules: `droppedForEvidence` and `tavilyCreditsUsed` (the app's GLOBAL Tavily counter, the same one that gates every live search) are counters, so nothing recorded means 0. A rate or an
 * average with nothing behind it is null: `falsePositiveRate` before an eval has run, `costPerEditionUsd` before the
 * build has recorded its model calls and a finished edition.
 */
export const LimitsBody = LimitsResponse;
export type LimitsBody = LimitsResponse;

/** The items Qloo's taste data drives (the event comes from Tavily, so its absence is not a Qloo gap). */
const QLOO_KINDS: ReadonlyArray<{ kind: EditionItemKind; label: string }> = [
  { kind: "special", label: "special" },
  { kind: "sound", label: "sound brief" },
  { kind: "partner", label: "local partner" },
];
const MAX_GAPS = 100;
const MAX_SENTENCE = 240;

const clip = (s: string): string => (s.length <= MAX_SENTENCE ? s : `${s.slice(0, MAX_SENTENCE - 1)}…`);

/** One plain sentence per gap, drawn from the editions the workspace holds. */
export function coverageGaps(stores: Store[], editions: Edition[]): string[] {
  const gaps: string[] = [];
  const finished = editions.filter((e) => e.status !== "drafting");

  const qloo = finished.flatMap((e) => e.evidence.filter((ev) => ev.source === "qloo"));
  const fixture = qloo.filter((ev) => ev.mode === "fixture").length;
  if (fixture > 0) {
    gaps.push(clip(`${fixture} of ${qloo.length} Qloo evidence records in these editions are sample data, not live Qloo responses.`));
  }

  const byStore = new Map(finished.map((e) => [e.storeId, e]));
  for (const store of stores) {
    const edition = byStore.get(store.id);
    if (!edition) {
      const building = editions.some((e) => e.storeId === store.id);
      if (!building) gaps.push(clip(`${store.name}: no edition has been built yet.`));
      continue;
    }
    const kinds = new Set(edition.items.map((i) => i.kind));
    for (const { kind, label } of QLOO_KINDS) {
      if (!kinds.has(kind)) gaps.push(clip(`${store.name}: this week's edition has no ${label}; no candidate backed by Qloo evidence was kept.`));
    }
  }
  return gaps.slice(0, MAX_GAPS);
}

/** Tavily's counter against its hard total and daily slice; zeros when the ledger cannot be read. */
async function tavilyUsage(repo: Parameters<typeof cacheOfRepo>[0]): Promise<BudgetUsage> {
  const ledger = createLedger(cacheOfRepo(repo));
  try {
    const u = await ledger.usage();
    return { used: u.total, cap: u.totalCap, dailyUsed: u.today, dailyCap: u.dailyCap };
  } catch {
    const u = { totalCap: TOTAL_CREDIT_CAP, dailyCap: DAILY_CREDIT_SLICE };
    return { used: 0, cap: u.totalCap, dailyUsed: 0, dailyCap: u.dailyCap };
  }
}

/**
 * A public page: it reads the visitor's workspace if their cookie names one, otherwise the demo workspace (or nothing), and never
 * creates a workspace or sets a cookie.
 */
export const getLimits = withRoute(routes.getLimits, async (_input, ctx): Promise<LimitsBody> => {
  const repo = await getRepo();
  const workspace = await peekWorkspace(ctx.request, repo);
  const stores = workspace ? await repo.listStores(workspace.chainId) : [];
  const editions = stores.length ? await repo.listEditions({ storeIds: stores.map((s) => s.id) }) : [];
  const [dropped, evalResult, totals, tavily, qloo] = await Promise.all([
    readDropped(repo),
    readEval(repo),
    readMetricsTotals(repo),
    tavilyUsage(repo),
    qlooCallsUsed(),
  ]);
  const guardrailBlocks = editions.reduce((n, e) => n + e.items.filter((i) => i.guardrail.status === "blocked").length, 0);
  return {
    droppedForEvidence: Math.round(dropped),
    guardrailBlocks,
    falsePositiveRate: evalResult ? evalResult.falsePositiveRate : null,
    qlooCoverageGaps: coverageGaps(stores, editions),
    costPerEditionUsd: totals.editions > 0 ? totals.usd / totals.editions : null,
    tavilyCreditsUsed: tavily.used,
    tavily,
    qloo: qloo ? { used: qloo.total, cap: qloo.totalCap, dailyUsed: qloo.today, dailyCap: qloo.dailyCap } : null,
    rateLimits: rateLimitRows(),
    visitorBudgets: { workspaceUsd: WORKSPACE_BUDGET_USD, networkDailyUsd: IP_DAILY_BUDGET_USD, demoFloorUsd: DEMO_FLOOR_USD },
  };
});
