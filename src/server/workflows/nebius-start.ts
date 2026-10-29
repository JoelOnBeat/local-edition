import { JOB_BUNDLE } from "../jobs/job-bundle.generated";
import { createLogger } from "../log";
import { buildLocalEditionJob, createNebiusRest, isNebiusError, type TokenCache } from "../nebius";
import type { Repo } from "../store/repo";

const log = createLogger("nebius-start");

/**
 * Starts the weekly Nebius Serverless Job from the Worker (docs/CLOUDFLARE.md, approvals 2 and 3): sign a JWT with the
 * service account, exchange it for an IAM token, `POST /ai/v1/jobs`. One job runs `certify` then `eval` (the pip
 * install is paid once). No GitHub, no CLI, no registry. Skips cleanly while credentials or settings are missing, so
 * the weekly rebuild still completes; never logs the request, which carries the job's secrets.
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
    const built = buildLocalEditionJob({
      modes: ["certify", "eval"],
      appUrl,
      jobSecret,
      secrets: apiKey ? { NEBIUS_API_KEY: apiKey } : undefined,
      bundle: JOB_BUNDLE,
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
