import type { JobRun } from "@/contract";
import { recordJobRun } from "../handlers/proof-ledger";
import { createLogger } from "../log";
import { DEMO_WORKSPACE_ID, ensureDemoWorkspace } from "../session";
import { STALE_RUN_MS } from "../jobs/monday";
import type { Repo } from "../store/repo";
import { LIGHT_STEP, runEditionBuild, type BuildOutcome, type BuildPorts, type StepConfig, type StepLike } from "./edition-build";
import type { BuildWorkflowParams } from "./types";

const log = createLogger("weekly");

/**
 * What the weekly JobRun says about NeMo certification. The Worker never starts the Nebius job: from Cloudflare's egress the Nebius
 * control plane times out (522, docs/NEBIUS-REST.md), so certification is started on demand from a developer's CLI session
 * (`npx tsx scripts/nebius-job.ts certify eval`), and that run appears on the proof ledger as its own `manual` JobRun.
 */
export const CERTIFY_ON_DEMAND_NOTE = "NeMo certification is pending: it runs on demand from the CLI (scripts/nebius-job.ts), not on a schedule.";

/** The Ultra review is one call and is never retried: each retry would be billed again. It still needs room for the clash embeddings. */
export const REVIEW_STEP: StepConfig = { retries: { limit: 0, delay: "5 seconds" }, timeout: "3 minutes" };

export interface WeeklyPorts extends BuildPorts {
  repo: Repo;
  now(): Date;
  /** Nemotron 3 Ultra reads the demo workspace's fresh editions and saves its verdicts on them. Never throws. Absent in tests that skip it. */
  reviewDemo?(): Promise<{ reviewed: number; stopped: string | null }>;
}

export interface WeeklyOutcome {
  job: JobRun | null;
  build: BuildOutcome | null;
}

/**
 * WeeklyRebuild: the Monday cron's Workflow, Token Factory and Tavily only. Builds every demo-workspace store through
 * EditionBuild's steps (one retried step per store, progress in D1) and records a JobRun. It calls nothing on Nebius's
 * control plane: NeMo certification is a separate, on-demand CLI run (see CERTIFY_ON_DEMAND_NOTE).
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
  if (start.skip) return { job: null, build: null };

  const build = await runEditionBuild(step, ports, { ...params, workspaceId: DEMO_WORKSPACE_ID, storeIds: start.job.storeIds, trigger: "cron" });

  // The build's last step: the chain review, so the sample workspaces copied from these editions carry real reviewer notes.
  if (ports.reviewDemo && build.editionIds.length) {
    try {
      await step.do("review", REVIEW_STEP, async () => { await ports.reviewDemo!(); });
    } catch (e) {
      log.warn("demo review failed; the editions stay unreviewed", { err: e });
    }
  }

  const job = await step.do("job-finish", LIGHT_STEP, async () => {
    const ok = build.status !== "failed";
    const finished: JobRun = {
      ...start.job,
      status: ok ? "done" : "failed",
      finishedAt: ports.now().toISOString(),
      note: `${ok ? "Built" : "Build incomplete:"} ${build.editionIds.length} of ${start.job.storeIds.length} editions${build.failedStoreIds.length ? `; ${build.failedStoreIds.length} store(s) failed` : ""}${build.skippedStoreIds.length ? `; ${build.skippedStoreIds.length} store(s) skipped: a model was unavailable on Token Factory, they build on the next run` : ""}. ${CERTIFY_ON_DEMAND_NOTE}`,
    };
    await recordJobRun(repo, finished);
    return finished;
  });
  return { job, build };
}
