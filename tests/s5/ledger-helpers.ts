import { recordSteps, recordVerifierCounts } from "@/server/agent/stats";
import { createLedger } from "@/server/tavily/budget";
import type { Repo } from "@/server/store";

/** One recorded model call, as the build writes it (`agent/stats.ts`). */
export const recordStep = (repo: Repo, promptTokens: number, cachedTokens: number, completionTokens: number, usd: number) =>
  recordSteps(repo, [{ type: "step_metrics", role: "copy", model: "test-model", ms: 10, promptTokens, cachedTokens, completionTokens, usd }], 0);

/** Finished editions, the divisor of cost per edition. */
export const recordEditions = (repo: Repo, n: number) => recordSteps(repo, [], n);

/** Items the evidence verifier dropped. */
export const recordDropped = (repo: Repo, n: number) => recordVerifierCounts(repo, { noEvidence: n });

/** Tavily credits a workspace spent, through the same counter that enforces its daily cap. */
export const recordTavily = (repo: Repo, workspaceId: string, credits: number) =>
  createLedger({ get: (k) => repo.cacheGet(k), put: (k, v, ttl) => repo.cachePut(k, v, ttl) }).reserve(workspaceId, credits);
