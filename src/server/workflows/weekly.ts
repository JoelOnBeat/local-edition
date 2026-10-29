import type { JobRun } from "@/contract";
import { recordJobRun } from "../handlers/proof-ledger";
import { DEMO_WORKSPACE_ID, ensureDemoWorkspace } from "../session";
import { STALE_RUN_MS } from "../jobs/monday";
import type { Repo } from "../store/repo";
import { LIGHT_STEP, runEditionBuild, type BuildOutcome, type BuildPorts, type StepLike } from "./edition-build";
import { describeStart, JobStartRetryable, type DeleteJobResult, type JobCheck, type StartJobResult } from "./nebius-start";
import type { BuildWorkflowParams } from "./types";

export interface WeeklyPorts extends BuildPorts {
  repo: Repo;
  /** Starts the Nebius certify + eval job (REST, from the Worker). `now` fixes the job name, so a step retry cannot start a second job. */
  startJob(now: Date): Promise<StartJobResult>;
  /** The job's state (by id, or by name when the create only answered with that). */
  checkJob(ref: JobRef): Promise<JobCheck>;
  /** Deletes the job, whatever state it is in, so the secrets injected into it do not stay in its record. */
  deleteJob(ref: JobRef): Promise<DeleteJobResult>;
  now(): Date;
}

export interface JobRef {
  jobId: string | null;
  name: string;
}

/** The job runs about 5 to 8 minutes; poll each minute, for at most the platform's 1 h timeout plus a few minutes. */
export const JOB_POLL_INTERVAL = "60 seconds";
export const JOB_MAX_POLLS = 68;
const POLL_STEP = { ...LIGHT_STEP, retries: { limit: 2, delay: "5 seconds", backoff: "exponential" as const } };

export interface WeeklyOutcome {
  job: JobRun | null;
  build: BuildOutcome | null;
  nebius: StartJobResult | null;
  /** How the Nebius job ended and whether it was deleted; null when no job was started. */
  reaped: { state: string; deleted: boolean } | null;
}

/**
 * WeeklyRebuild: the Monday cron's Workflow. Builds every demo-workspace store through EditionBuild's steps
 * (one retried step per store, progress in D1), records a JobRun, then starts the Nebius `certify` + `eval` job
 * through the Nebius REST API; the job checks the week's copy with NeMo Guardrails and posts signed results back.
 */
export async function runWeeklyRebuild(step: StepLike, ports: WeeklyPorts, params: BuildWorkflowParams): Promise<WeeklyOutcome> {
  const { repo } = ports;
  const start = await step.do("job-start", LIGHT_STEP, async () => {
    const demo = await ensureDemoWorkspace(repo);
    const stores = await repo.listStores(demo.chainId);
    // The job's id comes from the run's id, so a retry of this step (after the record was written but the step failed) finds
    // its own job instead of mistaking it for someone else's running build and skipping the whole week.
    const jobId = `job-${params.runId}`;
    const own = await repo.getJobRun(jobId);
    const latest = own ? null : await repo.latestJobRun();
    // Same guard as the Monday route: a fresh running job means someone is already building.
    if (latest?.status === "running" && ports.now().getTime() - Date.parse(latest.startedAt) < STALE_RUN_MS) return { skip: true as const };
    if (!stores.length || !(await ports.runLog.start(params.runId, DEMO_WORKSPACE_ID, stores.length))) return { skip: true as const };
    if (own) return { skip: false as const, job: own };
    const job: JobRun = {
      id: jobId,
      trigger: "cron",
      mode: "rebuild",
      startedAt: ports.now().toISOString(),
      finishedAt: null,
      storeIds: stores.map((s) => s.id),
      status: "running",
      nebiusJobId: null,
      note: `Building ${stores.length} stores.`,
    };
    await recordJobRun(repo, job);
    return { skip: false as const, job };
  });
  if (start.skip) return { job: null, build: null, nebius: null, reaped: null };

  const build = await runEditionBuild(step, ports, { ...params, workspaceId: DEMO_WORKSPACE_ID, storeIds: start.job.storeIds, trigger: "cron" });

  // After the build, whatever its result: the certify job checks what exists. The job name derives from the run's start
  // time, which the first step memoised, so a retried step finds its own job instead of starting another.
  // The job name carries the time its per-job secret is valid from, so it is stamped now (after the build), once.
  const jobTime = new Date(await step.do("certify-clock", LIGHT_STEP, async () => ports.now().toISOString()));
  const nebius = await step.do("certify", { ...LIGHT_STEP, retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } }, async () => {
    try {
      return await ports.startJob(jobTime);
    } catch (e) {
      if (e instanceof JobStartRetryable) throw e;
      return { status: "failed", code: "nebius_error" } as StartJobResult;
    }
  }).catch((): StartJobResult => ({ status: "failed", code: "nebius_unavailable" }));

  const job = await step.do("job-finish", LIGHT_STEP, async () => {
    const ok = build.status === "done";
    const finished: JobRun = {
      ...start.job,
      status: ok ? "done" : "failed",
      finishedAt: ports.now().toISOString(),
      nebiusJobId: nebius.status === "started" ? nebius.jobId : null,
      note: `${ok ? "Built" : "Build incomplete:"} ${build.editionIds.length} of ${start.job.storeIds.length} editions${build.failedStoreIds.length ? `; ${build.failedStoreIds.length} store(s) failed` : ""}. ${describeStart(nebius)}`,
    };
    await recordJobRun(repo, finished);
    return finished;
  });

  const reaped = nebius.status === "started" ? await reapJob(step, ports, { jobId: nebius.jobId, name: nebius.name }, job) : null;
  return { job, build, nebius, reaped };
}

/**
 * Waits for the Nebius job to reach a terminal state, deletes it (Nebius cancels one still running), and records how it
 * ended on the JobRun. The job holds injected secrets, so a finished job must not stay in the project.
 */
async function reapJob(step: StepLike, ports: WeeklyPorts, ref: JobRef, job: JobRun): Promise<{ state: string; deleted: boolean }> {
  let last: JobCheck = { state: "UNKNOWN", terminal: false };
  for (let i = 0; i < JOB_MAX_POLLS && !last.terminal; i++) {
    await step.sleep(`certify-wait:${i}`, JOB_POLL_INTERVAL);
    last = await step.do(`certify-poll:${i}`, POLL_STEP, () => ports.checkJob(ref)).catch((): JobCheck => ({ state: "UNKNOWN", terminal: false }));
  }
  const gone: DeleteJobResult = await step
    .do("certify-delete", { ...LIGHT_STEP, retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } }, () => ports.deleteJob(ref))
    .catch((): DeleteJobResult => ({ status: "failed", code: "nebius_unavailable" }));
  const deleted = gone.status !== "failed";
  const outcome = { state: last.terminal ? last.state : `${last.state} (still running after the wait)`, deleted };
  await step.do("job-outcome", LIGHT_STEP, async () => {
    const tail = deleted ? "Deleted afterwards." : `Not deleted (${gone.status === "failed" ? gone.code : "unknown"}); delete it by hand.`;
    await recordJobRun(ports.repo, { ...job, note: `${job.note} Job ended ${outcome.state}. ${tail}` });
  });
  return outcome;
}
