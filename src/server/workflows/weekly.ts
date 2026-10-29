import type { JobRun } from "@/contract";
import { newId } from "@/lib/ids";
import { recordJobRun } from "../handlers/proof-ledger";
import { DEMO_WORKSPACE_ID, ensureDemoWorkspace } from "../session";
import { STALE_RUN_MS } from "../jobs/monday";
import type { Repo } from "../store/repo";
import { LIGHT_STEP, runEditionBuild, type BuildOutcome, type BuildPorts, type StepLike } from "./edition-build";
import { describeStart, JobStartRetryable, type StartJobResult } from "./nebius-start";
import type { BuildWorkflowParams } from "./types";

export interface WeeklyPorts extends BuildPorts {
  repo: Repo;
  /** Starts the Nebius certify + eval job (REST, from the Worker). `now` fixes the job name, so a step retry cannot start a second job. */
  startJob(now: Date): Promise<StartJobResult>;
  now(): Date;
}

export interface WeeklyOutcome {
  job: JobRun | null;
  build: BuildOutcome | null;
  nebius: StartJobResult | null;
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
    const latest = await repo.latestJobRun();
    // Same guard as the Monday route: a fresh running job means someone is already building.
    if (latest?.status === "running" && ports.now().getTime() - Date.parse(latest.startedAt) < STALE_RUN_MS) return { skip: true as const };
    if (!stores.length || !(await ports.runLog.start(params.runId, DEMO_WORKSPACE_ID, stores.length))) return { skip: true as const };
    const job: JobRun = {
      id: newId("job"),
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
  if (start.skip) return { job: null, build: null, nebius: null };

  const build = await runEditionBuild(step, ports, { ...params, workspaceId: DEMO_WORKSPACE_ID, storeIds: start.job.storeIds, trigger: "cron" });

  // After the build, whatever its result: the certify job checks what exists. The job name derives from the run's start
  // time, which the first step memoised, so a retried step finds its own job instead of starting another.
  const jobTime = new Date(start.job.startedAt);
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
  return { job, build, nebius };
}
