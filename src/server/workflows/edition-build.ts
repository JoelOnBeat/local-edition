import type { AgentEvent } from "@/contract";
import { createLogger } from "../log";
import type { RunLog } from "./run-log";
import type { BuildWorkflowParams } from "./types";

const log = createLogger("workflow");

/** The Workflow step API this logic needs (cloudflare:workers' WorkflowStep satisfies it; tests pass a fake). */
export interface StepLike {
  do<T>(name: string, config: StepConfig, callback: () => Promise<T>): Promise<T>;
}
export interface StepConfig {
  retries?: { limit: number; delay: string | number; backoff?: "constant" | "linear" | "exponential" };
  timeout?: string | number;
}

/** Retry once, five seconds later: a failed store costs real model tokens, so retries stay few. */
export const STORE_STEP: StepConfig = { retries: { limit: 1, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" };
export const LIGHT_STEP: StepConfig = { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "1 minute" };

export interface BuildPorts {
  runLog: RunLog;
  /** The store ids to build, or null when the workspace or a requested store does not exist. */
  planStores(params: BuildWorkflowParams): Promise<string[] | null>;
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
  const { runLog } = ports;
  const { runId, workspaceId } = params;

  const storeIds = await step.do("plan", LIGHT_STEP, async () => {
    const ids = await ports.planStores(params);
    if (!ids) {
      await runLog.append(runId, workspaceId, { type: "error", code: "unknown_store", message: "That workspace or one of its stores does not exist." });
      return null;
    }
    // Written once even if this step is retried.
    if (!(await runLog.hasEvents(runId))) await runLog.append(runId, workspaceId, { type: "run_started", runId, storeIds: ids });
    return ids;
  });
  if (!storeIds) {
    await step.do("finish:failed", LIGHT_STEP, () => runLog.finish(runId, "failed"));
    return { runId, editionIds: [], failedStoreIds: [], status: "failed", spendCap: false };
  }

  const editionIds: string[] = [];
  const failedStoreIds: string[] = [];
  let spendCap = false;
  for (const [index, storeId] of storeIds.entries()) {
    if (spendCap) break;
    let result: StoreResult | null = null;
    try {
      result = await step.do(`store:${storeId}`, STORE_STEP, () => buildOne(ports, params, storeId));
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
    await runLog.finish(runId, status);
  });
  return { runId, editionIds, failedStoreIds, status, spendCap };
}

/** One store inside one step attempt. Throws when the store failed outright, so the Workflow retries it. */
async function buildOne(ports: BuildPorts, params: BuildWorkflowParams, storeId: string): Promise<StoreResult> {
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
    await runLog.append(params.runId, params.workspaceId, event);
    if (event.type === "store_done") editionId = event.editionId;
    if (event.type === "error" && event.code === "spend_cap") spendCap = true;
  }
  if (fatal && !editionId) throw new Error(`Store ${storeId} failed: ${fatal}`);
  return { storeId, editionId, spendCap };
}
