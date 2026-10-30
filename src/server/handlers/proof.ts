import { ProofResponse, routes, type JobRun } from "@/contract";
import { withRoute } from "../http/api";
import { peekWorkspace } from "../session";
import { readModelSkips } from "../agent/stats";
import { getRepo } from "../store";
import { reviewsOf, seenModels, stepsWithSkips } from "./proof-steps";
import { readEval, readJobRuns, readMetricsTotals } from "./proof-ledger";

/**
 * GET /api/proof: what actually ran, from stored data only. No model call. A public page: it reads the visitor's workspace if their
 * cookie names one, otherwise the demo workspace, and never creates a workspace or sets a cookie.
 *
 * `spendPerEditionUsd` and `cachedRatio` are null until the build has recorded `step_metrics` and a finished edition
 * (`agent/stats.ts`, written by every build, regenerate, card and review run).
 */
export const ProofBody = ProofResponse;
export type ProofBody = ProofResponse;

const SHA = /^[0-9a-f]{7,64}$/i;
const cleanSha = (raw: string | undefined): string | null => (raw && SHA.test(raw.trim()) ? raw.trim().toLowerCase() : null);

/**
 * The jobs script hash: `JOB_SCRIPT_SHA` when the deploy sets it (sha256 of jobs/certify.py, computed at build time),
 * otherwise the hash the newest job run reported for itself.
 */
export function scriptShaFrom(runs: JobRun[], env: Record<string, string | undefined> = process.env): string | null {
  const fromEnv = cleanSha(env.JOB_SCRIPT_SHA);
  if (fromEnv) return fromEnv;
  const certify = runs.find((r) => r.mode === "certify" && r.scriptSha);
  return cleanSha((certify ?? runs.find((r) => r.scriptSha))?.scriptSha ?? undefined);
}

export const getProof = withRoute(routes.getProof, async (_input, ctx): Promise<ProofBody> => {
  const repo = await getRepo();
  const workspace = await peekWorkspace(ctx.request, repo);
  const stores = workspace ? await repo.listStores(workspace.chainId) : [];
  const chain = workspace ? await repo.getChain(workspace.chainId) : null;
  const editions = stores.length ? await repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true }) : [];
  const [jobRuns, evalResult, totals, skips] = await Promise.all([readJobRuns(repo), readEval(repo), readMetricsTotals(repo), readModelSkips(repo)]);
  return {
    jobRuns,
    eval: evalResult,
    scriptSha: scriptShaFrom(jobRuns),
    gitSha: cleanSha(process.env.GIT_SHA),
    spendPerEditionUsd: totals.editions > 0 ? totals.usd / totals.editions : null,
    cachedRatio: totals.promptTokens > 0 ? Math.min(1, totals.cachedTokens / totals.promptTokens) : null,
    steps: stepsWithSkips(skips),
    seenModels: seenModels(editions),
    editionCount: editions.length,
    reviews: reviewsOf(editions, stores),
    sample: chain?.isSample ?? true,
  };
});
