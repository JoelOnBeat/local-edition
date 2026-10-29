import { deriveJobSecret } from "../jobs/hmac";
import { JOB_BUNDLE, JOB_PACK_B64 } from "../jobs/job-bundle.generated";
import { createLogger } from "../log";
import { buildLocalEditionJob, createNebiusRest, isNebiusError, isTerminalState, LOCAL_EDITION_PROJECT_ID, localEditionJobName, type TokenCache } from "../nebius";
import type { Repo } from "../store/repo";

const log = createLogger("nebius-start");

/**
 * Starts the weekly Nebius Serverless Job from the Worker (docs/CLOUDFLARE.md, approvals 2 and 3): sign a JWT with the
 * service account, exchange it for an IAM token, `POST /ai/v1/jobs`. One job runs `certify` then `eval` (the pip
 * install is paid once). No GitHub, no CLI, no registry. Skips cleanly while credentials or settings are missing, so
 * the weekly rebuild still completes; never logs the request, which carries the job's secrets.
 *
 * The job never holds the shared `LE_JOB_SECRET`: it gets HMAC(shared secret, job name), which the app accepts only for
 * that name and within an hour of its timestamp. `checkWeeklyJob` and `deleteWeeklyJob` are the Workflow's last steps:
 * once the job is finished it is deleted, so its injected secrets do not sit in the job record.
 */

export type StartJobResult =
  | { status: "started"; name: string; jobId: string | null; existing: boolean }
  | { status: "skipped"; reason: "no_credentials" | "no_app_url" | "no_job_secret" }
  | { status: "failed"; code: string };

/** Thrown for a failure worth retrying (Nebius unavailable or out of capacity); the Workflow step retries it. */
export class JobStartRetryable extends Error {
  constructor(readonly code: string) {
    super(`Nebius job start failed (${code}); retrying.`);
    this.name = "JobStartRetryable";
  }
}

export interface StartJobInput {
  /** Worker env: `NEBIUS_SA_CREDENTIALS`, `LE_JOB_SECRET`, `NEBIUS_API_KEY` (secrets); `APP_URL`, `NEBIUS_PROJECT_ID` (vars). */
  env: Record<string, unknown>;
  repo: Pick<Repo, "cacheGet" | "cachePut">;
  /** Fixes the job name (to the minute). Pass a time that is stable across step retries, or a retry would start a second job. */
  now: Date;
  fetchImpl?: typeof fetch;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The IAM token lives in the repo's cache (KV on Workers), so every isolate and every week shares one exchange. */
function tokenCache(repo: StartJobInput["repo"]): TokenCache {
  return {
    get: async (key) => {
      const v = await repo.cacheGet<unknown>(key);
      return typeof v === "string" ? v : null;
    },
    put: (key, value, ttl) => repo.cachePut(key, value, ttl),
  };
}

export async function startWeeklyJob(input: StartJobInput): Promise<StartJobResult> {
  const { env } = input;
  const credentialsJson = str(env.NEBIUS_SA_CREDENTIALS);
  if (!credentialsJson) return { status: "skipped", reason: "no_credentials" };
  const appUrl = str(env.APP_URL);
  if (!/^https:\/\//.test(appUrl)) return { status: "skipped", reason: "no_app_url" };
  const jobSecret = str(env.LE_JOB_SECRET);
  if (jobSecret.length < 32) return { status: "skipped", reason: "no_job_secret" };
  const apiKey = str(env.NEBIUS_API_KEY);

  try {
    const { jobs } = createNebiusRest({ credentialsJson, cache: tokenCache(input.repo), fetchImpl: input.fetchImpl });
    const modes = ["certify", "eval"] as const;
    const built = buildLocalEditionJob({
      modes,
      appUrl,
      jobSecret: await deriveJobSecret(jobSecret, localEditionJobName(modes, input.now)),
      secrets: apiKey ? { NEBIUS_API_KEY: apiKey } : undefined,
      bundle: JOB_BUNDLE,
      pack: JOB_PACK_B64,
      trigger: "cron",
      now: input.now,
      parentId: str(env.NEBIUS_PROJECT_ID) || undefined,
    });
    try {
      const { jobId } = await jobs.create(built.request);
      return { status: "started", name: built.name, jobId, existing: false };
    } catch (e) {
      // An earlier attempt of this step created it (the response was lost): the name is stable, so this is the same job.
      if (isNebiusError(e) && e.code === "nebius_conflict") {
        const job = await jobs.getByName(built.request.metadata.parentId, built.name);
        return { status: "started", name: built.name, jobId: job.metadata.id ?? null, existing: true };
      }
      throw e;
    }
  } catch (e) {
    if (isNebiusError(e)) {
      log.warn("weekly job not started", { code: e.code, status: e.status });
      if (e.retryable) throw new JobStartRetryable(e.code);
      return { status: "failed", code: e.code };
    }
    log.warn("weekly job not started", { err: (e as Error)?.name });
    return { status: "failed", code: "nebius_error" };
  }
}

export function describeStart(r: StartJobResult): string {
  if (r.status === "started") return `Nebius job ${r.name} ${r.existing ? "was already running" : "started"} (certify, then eval).`;
  if (r.status === "skipped") return `Nebius job not started (${r.reason.replace(/_/g, " ")}).`;
  return `Nebius job not started (${r.code}).`;
}

/** Where a started job stands, for the Workflow's wait-and-delete steps. */
export interface JobCheck {
  state: string;
  terminal: boolean;
}

export type DeleteJobResult = { status: "deleted"; state: string } | { status: "gone" } | { status: "failed"; code: string };

function restFor(input: Pick<StartJobInput, "env" | "repo" | "fetchImpl">) {
  const credentialsJson = str(input.env.NEBIUS_SA_CREDENTIALS);
  if (!credentialsJson) return null;
  return createNebiusRest({ credentialsJson, cache: tokenCache(input.repo), fetchImpl: input.fetchImpl }).jobs;
}

const projectOf = (env: Record<string, unknown>) => str(env.NEBIUS_PROJECT_ID) || LOCAL_EDITION_PROJECT_ID;

/** The job's state, by id or (when the create answered with a name only) by name. Throws a retryable error for a transient failure. */
export async function checkWeeklyJob(input: Pick<StartJobInput, "env" | "repo" | "fetchImpl">, ref: { jobId: string | null; name: string }): Promise<JobCheck> {
  const jobs = restFor(input);
  if (!jobs) return { state: "UNKNOWN", terminal: true };
  try {
    const job = ref.jobId ? await jobs.get(ref.jobId) : await jobs.getByName(projectOf(input.env), ref.name);
    const state = job.status?.state ?? "STATE_UNSPECIFIED";
    return { state, terminal: isTerminalState(state) || state === "DELETING" };
  } catch (e) {
    if (isNebiusError(e) && e.code === "nebius_not_found") return { state: "DELETED", terminal: true };
    if (isNebiusError(e) && e.retryable) throw new JobStartRetryable(e.code);
    log.warn("weekly job state unreadable", { code: isNebiusError(e) ? e.code : (e as Error)?.name });
    return { state: "UNKNOWN", terminal: false };
  }
}

/**
 * Deletes the job (Nebius cancels a running one first), so the secrets injected into it stop existing. Deletion is
 * asynchronous on Nebius's side (the record shows DELETING for a few minutes), so `deleted` means "accepted".
 */
export async function deleteWeeklyJob(input: Pick<StartJobInput, "env" | "repo" | "fetchImpl">, ref: { jobId: string | null; name: string }): Promise<DeleteJobResult> {
  const jobs = restFor(input);
  if (!jobs) return { status: "failed", code: "no_credentials" };
  try {
    const job = ref.jobId ? null : await jobs.getByName(projectOf(input.env), ref.name);
    const id = ref.jobId ?? job?.metadata.id;
    if (!id) return { status: "gone" };
    const before = job?.status?.state ?? (await jobs.get(id).then((j) => j.status?.state ?? "STATE_UNSPECIFIED", () => "UNKNOWN"));
    await jobs.delete(id);
    return { status: "deleted", state: before };
  } catch (e) {
    if (isNebiusError(e) && e.code === "nebius_not_found") return { status: "gone" };
    if (isNebiusError(e) && e.retryable) throw new JobStartRetryable(e.code);
    return { status: "failed", code: isNebiusError(e) ? e.code : "nebius_error" };
  }
}
