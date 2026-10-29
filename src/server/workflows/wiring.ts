import type { AgentEvent } from "@/contract";
import { buildEditions } from "../agent/build";
import { getAgentDeps } from "../agent/deps";
import { platformEnv, type PlatformEnv } from "../platform/env";
import { getRepo } from "../store";
import type { BuildPorts } from "./edition-build";
import { startWeeklyJob } from "./nebius-start";
import { RunLog } from "./run-log";
import type { WeeklyPorts } from "./weekly";

/** The real ports for a Workflow instance: the D1 run log, the existing per-store build, the Nebius job start. */
export async function realBuildPorts(): Promise<BuildPorts & { env: PlatformEnv }> {
  const env = await platformEnv();
  if (!env?.LE_DB) throw new Error("D1 binding LE_DB is not available to the Workflow.");
  const repo = await getRepo();
  return {
    env,
    runLog: new RunLog(env.LE_DB),
    async planStores(params) {
      const workspace = await repo.getWorkspace(params.workspaceId);
      const chain = workspace && (await repo.getChain(workspace.chainId));
      if (!chain) return null;
      const all = (await repo.listStores(chain.id)).map((s) => s.id);
      if (params.storeIds?.some((id) => !all.includes(id))) return null;
      return params.storeIds ?? all;
    },
    // The existing per-store pipeline (tool loop, evidence check, copy, guardrails, persist); one store per call.
    buildStore(storeId, params): AsyncIterable<AgentEvent> {
      return (async function* () {
        const deps = await getAgentDeps();
        yield* buildEditions({ workspaceId: params.workspaceId, storeIds: [storeId], weekOf: params.weekOf, runId: params.runId, force: params.force }, deps);
      })();
    },
  };
}

export async function realWeeklyPorts(): Promise<WeeklyPorts> {
  const base = await realBuildPorts();
  const { env } = base;
  const repo = await getRepo();
  return {
    ...base,
    repo,
    now: () => new Date(),
    startJob: (now) => startWeeklyJob({ env, repo, now }),
  };
}
