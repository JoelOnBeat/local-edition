import type { AgentEvent } from "@/contract";
import { createLogger } from "../log";
import { WORKFLOW_LOCK_TTL_SECONDS } from "../agent/build-lock";
import type { EventAttempt, RunLog } from "./run-log";
import type { BuildWorkflowParams, SlackRegenerateJob } from "./types";

const log = createLogger("workflow");

/** What a step callback is told: `attempt` counts from 1 (Cloudflare passes it as the callback's first argument). */
export interface StepContext {
  attempt: number;
}

/** The Workflow step API this logic needs (cloudflare:workers' WorkflowStep satisfies it; tests pass a fake). */
export interface StepLike {
  do<T>(name: string, config: StepConfig, callback: (ctx: StepContext) => Promise<T>): Promise<T>;
  sleep(name: string, duration: string | number): Promise<void>;
}
export interface StepConfig {
  retries?: { limit: number; delay: string | number; backoff?: "constant" | "linear" | "exponential" };
  timeout?: string | number;
}

/** Retry once, five seconds later: a failed store costs real model tokens, so retries stay few. */
export const STORE_STEP: StepConfig = { retries: { limit: 1, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" };
/** The week's live Tavily batch (8 searches and a page read) runs long, so it gets its own step with a generous timeout and two retries. */
export const PREFETCH_STEP: StepConfig = { retries: { limit: 2, delay: "3 seconds", backoff: "exponential" }, timeout: "3 minutes" };
/** One retry: the digest is idempotent (a claim per set of edition states), so a repeat cannot post twice. */
export const DIGEST_STEP: StepConfig = { retries: { limit: 1, delay: "5 seconds" }, timeout: "1 minute" };
export const LIGHT_STEP: StepConfig = { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "1 minute" };

/**
 * The workspace's build lock, held by the Workflow for the whole run so a rebuild, a regenerate or a second run cannot
 * interleave with it. `owner` is the run id: asking again with it (a retried step, the next store) extends its own lock.
 * `acquire` is false when someone else holds the lock; it throws when the lock cannot be reached at all (no fallback lock).
 */
export interface RunLock {
  acquire(workspaceId: string, owner: string, ttlSeconds: number): Promise<boolean>;
  release(workspaceId: string, owner: string): Promise<void>;
}

export interface BuildPorts {
  runLog: RunLog;
  /** Absent in unit tests of the logic that do not care about locking. Production always sets it. */
  lock?: RunLock;
  /** The store ids to build, or null when the workspace or a requested store does not exist. */
  planStores(params: BuildWorkflowParams): Promise<string[] | null>;
  /**
   * Saves the week's events (live Tavily) before any store is built, so `events_this_week` reads the cache. It never throws for a budget
   * or upstream problem; if it does throw, the run goes on and the agent uses saved events.
   */
  prefetchEvents?(params: BuildWorkflowParams, storeIds: string[]): Promise<void>;
  /**
   * The run finished and `run_done` is in the log: post the head-office digest to Slack when it is connected. Failures here are logged and
   * ignored; they never fail the build.
   */
  afterBuild?(params: BuildWorkflowParams, editionIds: string[]): Promise<void>;
  /** A Slack Regenerate click (`params.regenerate`): the item's rewrite and the digest message's update. It settles its own failures. */
  regenerate?(workspaceId: string, job: SlackRegenerateJob): Promise<void>;
  /** One store's build: the existing per-store pipeline in src/server/agent/build.ts. */
  buildStore(storeId: string, params: BuildWorkflowParams): AsyncIterable<AgentEvent>;
}

export interface BuildOutcome {
  runId: string;
  editionIds: string[];
  failedStoreIds: string[];
  status: "done" | "failed";
  spendCap: boolean;
}

interface StoreResult {
  storeId: string;
  editionId: string | null;
  spendCap: boolean;
}

/** `run_started` and `run_done` belong to the whole run, which the Workflow emits itself, once. */
const WRAPPER_EVENTS = new Set<AgentEvent["type"]>(["run_started", "run_done"]);

/**
 * EditionBuild, as plain logic over a step API. Everything with a side effect is inside a `step.do`: the
 * Workflow replays `run()` from the top after a restart and skips finished steps, so code between steps must
 * be pure. One retried step per store; every event goes to D1 as it happens; the SSE route tails that log.
 */
export async function runEditionBuild(step: StepLike, ports: BuildPorts, params: BuildWorkflowParams): Promise<BuildOutcome> {
  if (params.regenerate) return runRegenerate(step, ports, params, params.regenerate);
  const { runLog } = ports;
  const { runId, workspaceId } = params;

  // The run takes the workspace lock here and keeps it until `finish`; each store step extends it.
  type Plan = { ids: string[] } | { ids: null; code: "unknown_store" | "build_running" };
  let plan: Plan;
  try {
    plan = await step.do("plan", LIGHT_STEP, async (): Promise<Plan> => {
      if (ports.lock && !(await ports.lock.acquire(workspaceId, runId, WORKFLOW_LOCK_TTL_SECONDS))) return { ids: null, code: "build_running" };
      const ids = await ports.planStores(params);
      if (!ids) {
        await runLog.append(runId, workspaceId, { type: "error", code: "unknown_store", message: "That workspace or one of its stores does not exist." });
        await ports.lock?.release(workspaceId, runId);
        return { ids: null, code: "unknown_store" };
      }
      // Written once even if this step is retried.
      if (!(await runLog.hasEvents(runId))) await runLog.append(runId, workspaceId, { type: "run_started", runId, storeIds: ids });
      return { ids };
    });
  } catch (e) {
    // The lock could not even be reached (no fallback lock is ever used), or the plan kept failing: end the run cleanly.
    log.error("plan step failed", { runId, err: e });
    await step.do("finish:unavailable", LIGHT_STEP, async () => {
      await runLog.append(runId, workspaceId, { type: "error", code: "lock_unavailable", message: "The build could not start. Try again." });
      await ports.lock?.release(workspaceId, runId).catch(() => undefined);
      await runLog.finish(runId, "failed");
    });
    return { runId, editionIds: [], failedStoreIds: [], status: "failed", spendCap: false };
  }
  if (!plan.ids) {
    await step.do("finish:failed", LIGHT_STEP, async () => {
      if (plan.ids === null && plan.code === "build_running") {
        await runLog.append(runId, workspaceId, { type: "error", code: "build_running", message: "A build is already running for this workspace. Wait for it to finish." });
      }
      await runLog.finish(runId, "failed");
    });
    return { runId, editionIds: [], failedStoreIds: [], status: "failed", spendCap: false };
  }
  const storeIds = plan.ids;

  const editionIds: string[] = [];
  const failedStoreIds: string[] = [];
  let spendCap = false;
  if (ports.prefetchEvents) {
    try {
      await step.do("prefetch-events", PREFETCH_STEP, async () => { await ports.prefetchEvents!(params, storeIds); });
    } catch (e) {
      log.warn("events prefetch failed; the stores use saved events", { runId, err: e });
    }
  }
  try {
    for (const [index, storeId] of storeIds.entries()) {
      if (spendCap) break;
      let result: StoreResult | null = null;
      try {
        result = await step.do(`store:${storeId}`, STORE_STEP, (ctx) => buildOne(ports, params, storeId, ctx?.attempt ?? 1));
      } catch (e) {
        // Retries are spent. The run carries on with the next store, as the in-process build does.
        log.error("store step failed", { storeId, err: e });
        failedStoreIds.push(storeId);
        await step.do(`store-failed:${storeId}`, LIGHT_STEP, () => runLog.append(runId, workspaceId, { type: "error", storeId, code: "store_failed", message: "Could not finish the edition for this store." }));
      }
      if (result?.editionId) editionIds.push(result.editionId);
      if (result?.spendCap) spendCap = true;
      await step.do(`progress:${index}`, LIGHT_STEP, async () => {
        await runLog.append(runId, workspaceId, { type: "progress", runId, done: index + 1, total: storeIds.length });
        await runLog.setProgress(runId, index + 1);
      });
    }

    // A spend cap ends the run with an error and no `run_done`, like the in-process build.
    const status: BuildOutcome["status"] = spendCap ? "failed" : "done";
    await step.do("finish", LIGHT_STEP, async () => {
      if (!spendCap) await runLog.append(runId, workspaceId, { type: "run_done", runId, editionIds });
      // The lock goes first: a run row that still says `running` only refuses a second start, a lock held after the run
      // row says `done` would refuse the next build for the rest of its TTL.
      await ports.lock?.release(workspaceId, runId);
      await runLog.finish(runId, status);
    });
    if (status === "done" && editionIds.length && ports.afterBuild) {
      try {
        await step.do("digest", DIGEST_STEP, async () => { await ports.afterBuild!(params, editionIds); });
      } catch (e) {
        log.warn("head-office digest failed; the build is unaffected", { runId, err: e });
      }
    }
    return { runId, editionIds, failedStoreIds, status, spendCap };
  } catch (e) {
    // A step ran out of retries. Do not leave the workspace locked (or the run `running`) until the TTL passes.
    await step.do("finish:error", LIGHT_STEP, async () => {
      await ports.lock?.release(workspaceId, runId).catch(() => undefined);
      await runLog.finish(runId, "failed");
    }).catch(() => undefined);
    throw e;
  }
}

/** The REGENERATE step is long (a model rewrite and a guardrail check) but not retried: the click's claim makes a repeat a no-op. */
export const REGENERATE_STEP: StepConfig = { retries: { limit: 0, delay: "5 seconds" }, timeout: "5 minutes" };

/** A Slack Regenerate click as its own Workflow instance: one step, no run log, no workspace build lock. */
async function runRegenerate(step: StepLike, ports: BuildPorts, params: BuildWorkflowParams, job: SlackRegenerateJob): Promise<BuildOutcome> {
  const { runId, workspaceId } = params;
  let status: BuildOutcome["status"] = "done";
  try {
    await step.do("regenerate", REGENERATE_STEP, async () => {
      if (!ports.regenerate) throw new Error("This Workflow has no regenerate port.");
      await ports.regenerate(workspaceId, job);
    });
  } catch (e) {
    log.error("slack regenerate step failed", { runId, err: e });
    status = "failed";
  }
  return { runId, editionIds: [], failedStoreIds: [], status, spendCap: false };
}

/**
 * One store inside one step attempt. Throws when the store failed outright, so the Workflow retries it. Every event is
 * tagged with the attempt; from the second attempt on, the first attempt's events are superseded (not replayed again).
 */
async function buildOne(ports: BuildPorts, params: BuildWorkflowParams, storeId: string, attempt: number): Promise<StoreResult> {
  const { runLog } = ports;
  const by: EventAttempt = { scope: storeId, attempt };
  // Taking the lock again extends it for this step; false means it expired and someone else has it now.
  if (ports.lock && !(await ports.lock.acquire(params.workspaceId, params.runId, WORKFLOW_LOCK_TTL_SECONDS))) {
    throw new Error(`The workspace lock was lost before store ${storeId} could be built.`);
  }
  if (attempt > 1) await runLog.supersedeBefore(params.runId, by);
  try {
    return await buildAttempt(ports, params, storeId, by);
  } catch (e) {
    // Tell the live trace a retry is pending, so the lane reads Retrying rather than Failed. The retry supersedes this row.
    if (attempt <= (STORE_STEP.retries?.limit ?? 0)) {
      await runLog.append(params.runId, params.workspaceId, { type: "error", storeId, code: "store_retrying", message: "This attempt failed; trying again shortly." }, by).catch(() => undefined);
    }
    throw e;
  }
}

async function buildAttempt(ports: BuildPorts, params: BuildWorkflowParams, storeId: string, by: EventAttempt): Promise<StoreResult> {
  const { runLog } = ports;
  let editionId: string | null = null;
  let spendCap = false;
  let fatal: string | null = null;
  for await (const event of ports.buildStore(storeId, params)) {
    if (WRAPPER_EVENTS.has(event.type)) continue;
    if (event.type === "error" && (event.code === "store_failed" || event.code === "build_running")) {
      fatal = event.code; // not shown yet: the retry may succeed, and the final failure is reported by the caller
      continue;
    }
    await runLog.append(params.runId, params.workspaceId, event, by);
    if (event.type === "store_done") editionId = event.editionId;
    if (event.type === "error" && event.code === "spend_cap") spendCap = true;
  }
  if (fatal && !editionId) throw new Error(`Store ${storeId} failed: ${fatal}`);
  return { storeId, editionId, spendCap };
}
