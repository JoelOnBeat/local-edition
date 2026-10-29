import type { EvalResult, JobMode, JobRun } from "@/contract";
import { LEDGER_KEYS, recordJobRun } from "../handlers/proof-ledger";
import type { Repo } from "../store";

/**
 * Job runs of the Nebius batch job (certify, eval, import) and the latest eval, written to the shared proof ledger
 * (`handlers/proof-ledger.ts`, read by /api/proof and /api/limits). A run is written once, when the job reports, as
 * `done`: never `running`, because `startMondayJob` treats a running latest run as a build in flight.
 * `putJobRun` moves `job:latest`, so `/api/jobs/latest` can name a batch run until a rebuild writes a newer one.
 */

/** Repo-cache key of the latest EvalResult. */
export const EVAL_KEY = LEDGER_KEYS.evalLatest;
const EVAL_TTL_SECONDS = 90 * 24 * 3600;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One run id per (mode, job id): a retried report overwrites its own row instead of adding another. */
export async function batchRunId(mode: JobMode, jobId: string): Promise<string> {
  return `job_${mode}_${(await sha256Hex(`${mode}:${jobId}`)).slice(0, 12)}`;
}

export interface RecordRunInput {
  mode: Exclude<JobMode, "rebuild">;
  jobId: string;
  trigger: JobRun["trigger"];
  startedAt: string;
  scriptSha: string | null;
  storeIds: string[];
  note: string;
  status?: JobRun["status"];
  now?: () => Date;
}

export async function recordBatchRun(repo: Repo, input: RecordRunInput): Promise<JobRun> {
  const id = await batchRunId(input.mode, input.jobId);
  const finishedAt = (input.now ?? (() => new Date()))().toISOString();
  const run: JobRun = {
    id,
    trigger: input.trigger,
    startedAt: input.startedAt,
    finishedAt,
    storeIds: [...new Set(input.storeIds)],
    status: input.status ?? "done",
    nebiusJobId: input.jobId,
    note: input.note.slice(0, 500),
    mode: input.mode,
    scriptSha: input.scriptSha,
  };
  return recordJobRun(repo, run);
}

export async function saveEval(repo: Repo, result: EvalResult): Promise<void> {
  await repo.cachePut(EVAL_KEY, result, EVAL_TTL_SECONDS);
}
