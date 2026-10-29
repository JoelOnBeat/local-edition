import { z } from "zod";
import type { Repo } from "../store/repo";
import type { StepEvent } from "./metrics";

/**
 * Running totals the /api/proof and /api/limits routes read: model-call metrics and evidence-verifier counts.
 * Stored in the repo's cache (KV on Workers) under one key each, workspace-independent like the spend ledger.
 * Read-modify-write without a compare-and-swap: two runs finishing together can lose one update, which is
 * acceptable for a published tally and never affects an edition.
 */

const TTL_SECONDS = 35 * 24 * 3600;
const METRICS_KEY = "stats:metrics:v1";
const VERIFY_KEY = "stats:verify:v1";

const RoleTotals = z.object({ calls: z.number(), promptTokens: z.number(), cachedTokens: z.number(), completionTokens: z.number(), usd: z.number() });
export const MetricsTotals = z.object({
  calls: z.number(),
  promptTokens: z.number(),
  cachedTokens: z.number(),
  completionTokens: z.number(),
  usd: z.number(),
  /** Editions built by runs recorded here; `usd / editions` is the cost per edition. */
  editions: z.number(),
  byRole: z.record(z.string(), RoleTotals),
  updatedAt: z.string(),
});
export type MetricsTotals = z.infer<typeof MetricsTotals>;

const emptyTotals = (): MetricsTotals => ({ calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, usd: 0, editions: 0, byRole: {}, updatedAt: new Date(0).toISOString() });

export async function readMetricsTotals(repo: Pick<Repo, "cacheGet">): Promise<MetricsTotals> {
  const parsed = MetricsTotals.safeParse(await repo.cacheGet(METRICS_KEY).catch(() => null));
  return parsed.success ? parsed.data : emptyTotals();
}

/** Add a run's steps (and the editions it built) to the totals. Never throws: a failed tally must not fail a build. */
export async function recordSteps(repo: Pick<Repo, "cacheGet" | "cachePut">, steps: StepEvent[], editions: number, now = new Date()): Promise<void> {
  if (!steps.length && !editions) return;
  try {
    const t = await readMetricsTotals(repo);
    for (const s of steps) {
      const r = (t.byRole[s.role] ??= { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, usd: 0 });
      for (const bucket of [t, r]) {
        bucket.calls += 1;
        bucket.promptTokens += s.promptTokens;
        bucket.cachedTokens += s.cachedTokens;
        bucket.completionTokens += s.completionTokens;
        bucket.usd += s.usd;
      }
    }
    t.editions += editions;
    t.updatedAt = now.toISOString();
    await repo.cachePut(METRICS_KEY, t, TTL_SECONDS);
  } catch {
    // Tally only.
  }
}

export const VerifierCounts = z.object({
  /** Items the verifier looked at. */
  checked: z.number(),
  /** Dropped because no evidence row backed them. */
  noEvidence: z.number(),
  /** Dropped because a cited lift did not recompute from the cached Qloo payload. */
  liftMismatch: z.number(),
  /** Dropped because a cited entity id was not in the cached Qloo payload. */
  entityMissing: z.number(),
  /** Dropped for having too few artists to build a sound brief. */
  tooFewArtists: z.number(),
  /** Items kept whose lift could not be recomputed (no cached baseline). */
  unverified: z.number(),
  /** The seeded test item (fixture mode only) caught by the verifier. Never counted above. */
  seededCaught: z.number(),
  updatedAt: z.string(),
});
export type VerifierCounts = z.infer<typeof VerifierCounts>;

const emptyCounts = (): VerifierCounts => ({ checked: 0, noEvidence: 0, liftMismatch: 0, entityMissing: 0, tooFewArtists: 0, unverified: 0, seededCaught: 0, updatedAt: new Date(0).toISOString() });

/** Items dropped for evidence reasons (what /limits calls `droppedForEvidence`): everything except the seeded test. */
export const droppedForEvidence = (c: VerifierCounts): number => c.noEvidence + c.liftMismatch + c.entityMissing + c.tooFewArtists;

export async function readVerifierCounts(repo: Pick<Repo, "cacheGet">): Promise<VerifierCounts> {
  const parsed = VerifierCounts.safeParse(await repo.cacheGet(VERIFY_KEY).catch(() => null));
  return parsed.success ? parsed.data : emptyCounts();
}

export type VerifierDelta = Partial<Omit<VerifierCounts, "updatedAt">>;

export async function recordVerifierCounts(repo: Pick<Repo, "cacheGet" | "cachePut">, delta: VerifierDelta, now = new Date()): Promise<void> {
  try {
    const c = await readVerifierCounts(repo);
    for (const key of Object.keys(delta) as (keyof VerifierDelta)[]) c[key] += delta[key] ?? 0;
    c.updatedAt = now.toISOString();
    await repo.cachePut(VERIFY_KEY, c, TTL_SECONDS);
  } catch {
    // Tally only.
  }
}
