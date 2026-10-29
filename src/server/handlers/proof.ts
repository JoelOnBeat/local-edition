import { ProofResponse, routes, type JobRun } from "@/contract";
import { withRoute } from "../http/api";
import { getRepo } from "../store";
import { readEval, readJobRuns, readMetricsTotals } from "./proof-ledger";

/**
 * GET /api/proof: what actually ran, from stored data only. No cookie, no model call.
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

export const getProof = withRoute(routes.getProof, async (): Promise<ProofBody> => {
  const repo = await getRepo();
  const [jobRuns, evalResult, totals] = await Promise.all([readJobRuns(repo), readEval(repo), readMetricsTotals(repo)]);
  return {
    jobRuns,
    eval: evalResult,
    scriptSha: scriptShaFrom(jobRuns),
    gitSha: cleanSha(process.env.GIT_SHA),
    spendPerEditionUsd: totals.editions > 0 ? totals.usd / totals.editions : null,
    cachedRatio: totals.promptTokens > 0 ? Math.min(1, totals.cachedTokens / totals.promptTokens) : null,
  };
});
