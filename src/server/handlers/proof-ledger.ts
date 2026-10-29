import { z } from "zod";
import { EvalResult, JobRun, type JobMode } from "@/contract";
import { droppedForEvidence, readMetricsTotals, readVerifierCounts } from "../agent/stats";
import { tavilyCreditsUsed } from "../tavily/budget";
import type { Repo } from "../store";

/**
 * The shared ledger behind GET /api/proof and GET /api/limits: a few small rows in the repo cache (KV on Workers) that
 * the writers update as they work and these two routes only read. Nothing here calls a model.
 *
 * Who writes what:
 * - `eval:latest`        the last EvalResult. Written by POST /api/jobs/eval (`saveEval`).
 * - `jobrun:last:<mode>` the last JobRun of each mode. Written through `recordJobRun` (the Monday route, the weekly
 *                        Workflow and the batch-job routes all use it).
 * - model-call totals    `agent/stats.ts`: every build, regenerate, card and review run adds its `step_metrics` and the
 *                        editions it finished (`recordSteps`). Read here with `readMetricsTotals`.
 * - evidence drops       `agent/stats.ts`: the verifier's counts (`recordVerifierCounts`); `readDropped` sums them.
 * - Tavily credits       `tavily/budget.ts`: the per-workspace credit counter that gates the daily cap
 *                        (`tavilyCreditsUsed`); `/api/limits` reads the visitor's own total.
 *
 * Counters are read-modify-write on a cache that has no compare-and-swap: exact inside one isolate, best effort across
 * isolates. A missing row means nothing was recorded, and the routes then report `null` for an average rather than
 * inventing one.
 */

export const LEDGER_KEYS = {
  evalLatest: "eval:latest",
  jobRunLast: (mode: JobMode): string => `jobrun:last:${mode}`,
} as const;

/** The ledger lives as long as the hackathon needs (judging runs to 16 Dec); every write refreshes the TTL. */
const LEDGER_TTL_SECONDS = 90 * 24 * 3600;

async function readParsed<T>(repo: Pick<Repo, "cacheGet">, key: string, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await repo.cacheGet<unknown>(key));
  return parsed.success ? parsed.data : null;
}

// ---- Readers (the proof and limits routes)

export const readEval = (repo: Repo): Promise<EvalResult | null> => readParsed(repo, LEDGER_KEYS.evalLatest, EvalResult);
export { readMetricsTotals };
/** Items dropped because they lacked (or failed) their evidence. The verifier's seeded fixture-mode test item is not counted. */
export const readDropped = async (repo: Repo): Promise<number> => droppedForEvidence(await readVerifierCounts(repo));
/** Tavily credits the visitor's workspace has spent (the counter behind its daily cap). */
export const readTavilyCredits = (repo: Pick<Repo, "cacheGet" | "cachePut">, workspaceId: string): Promise<number> =>
  tavilyCreditsUsed({ get: (key) => repo.cacheGet(key), put: (key, value, ttl) => repo.cachePut(key, value, ttl) }, workspaceId);

const MODES: readonly JobMode[] = ["rebuild", "certify", "eval", "import"];
const MAX_JOB_RUNS = 8;

/** The newest run of each mode, plus the repo's latest run of any kind, newest first. Rows that do not parse are skipped. */
export async function readJobRuns(repo: Repo): Promise<JobRun[]> {
  const rows = await Promise.all(MODES.map((m) => readParsed(repo, LEDGER_KEYS.jobRunLast(m), JobRun)));
  const latest = JobRun.safeParse(await repo.latestJobRun());
  const byId = new Map<string, JobRun>();
  for (const run of [...rows, latest.success ? latest.data : null]) if (run && !byId.has(run.id)) byId.set(run.id, run);
  return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MAX_JOB_RUNS);
}

// ---- Writer

/** Saves the run (as `putJobRun` does) and remembers it as the newest of its mode, for the proof page. */
export async function recordJobRun(repo: Repo, run: JobRun): Promise<JobRun> {
  const saved = await repo.putJobRun(run);
  if (saved.mode) await repo.cachePut(LEDGER_KEYS.jobRunLast(saved.mode), saved, LEDGER_TTL_SECONDS);
  return saved;
}
