import type { AgentEvent } from "@/contract";
import type { BuildArgs } from "../jobs/ports";
import { buildEditions } from "./build";
import { getAgentDeps } from "./deps";

/**
 * Fits `buildEditions` to the Monday job's `BuildEditions` port (src/server/jobs/ports.ts):
 * `defaultPorts.buildEditions = buildEditionsForJob` in jobs/wiring.ts.
 */
export async function* buildEditionsForJob(args: BuildArgs): AsyncGenerator<AgentEvent> {
  const deps = await getAgentDeps();
  yield* buildEditions(
    { workspaceId: args.workspaceId, storeIds: args.stores.map((s) => s.id), weekOf: args.weekOf, runId: args.runId },
    { ...deps, repo: args.repo },
  );
}
