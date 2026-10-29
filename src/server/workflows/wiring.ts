import type { AgentEvent } from "@/contract";
import { buildEditions } from "../agent/build";
import { acquireBuildLock, ownedBuildLock, releaseBuildLock } from "../agent/build-lock";
import { getAgentDeps } from "../agent/deps";
import { HttpError } from "../http/errors";
import { platformEnv, type PlatformEnv } from "../platform/env";
import { getRepo } from "../store";
import type { BuildPorts } from "./edition-build";
import { RunLog } from "./run-log";
import type { WeeklyPorts } from "./weekly";

/** The real ports for a Workflow instance: the D1 run log, the existing per-store build. */
export async function realBuildPorts(): Promise<BuildPorts & { env: PlatformEnv }> {
  const env = await platformEnv();
  if (!env?.LE_DB) throw new Error("D1 binding LE_DB is not available to the Workflow.");
  const repo = await getRepo();
  return {
    env,
    runLog: new RunLog(env.LE_DB),
    // The run owns the workspace lock end to end (see RunLock). No repo-lock fallback when the Durable Object errors: the call throws.
    lock: {
      async acquire(workspaceId, owner, ttlSeconds) {
        try {
          await acquireBuildLock(repo, workspaceId, { owner, ttlSeconds });
          return true;
        } catch (e) {
          if (e instanceof HttpError && e.code === "build_running") return false;
          throw e;
        }
      },
      release: (workspaceId, owner) => releaseBuildLock(repo, ownedBuildLock(workspaceId, owner)),
    },
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
        // The lock is the run's, lent to the build so it neither takes nor releases one per store.
        const lock = ownedBuildLock(params.workspaceId, params.runId);
        yield* buildEditions({ workspaceId: params.workspaceId, storeIds: [storeId], weekOf: params.weekOf, runId: params.runId, force: params.force, lock }, deps);
      })();
    },
  };
}

export async function realWeeklyPorts(): Promise<WeeklyPorts> {
  const base = await realBuildPorts();
  return { ...base, repo: await getRepo(), now: () => new Date() };
}
