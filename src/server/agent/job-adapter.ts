import type { AgentEvent } from "@/contract";
import type { BuildArgs } from "../jobs/ports";
import { buildEditions } from "./build";
import { DEMO_WORKSPACE_ID } from "../session";
import { getAgentDeps } from "./deps";
import { reviewDemoWorkspace } from "./review-demo";

/**
 * Fits `buildEditions` to the Monday job's `BuildEditions` port (src/server/jobs/ports.ts):
 * `defaultPorts.buildEditions = buildEditionsForJob` in jobs/wiring.ts. The demo workspace's build ends with the Ultra review.
 */
export async function* buildEditionsForJob(args: BuildArgs): AsyncGenerator<AgentEvent> {
  const deps = { ...(await getAgentDeps()), repo: args.repo };
  let built = 0;
  for await (const event of buildEditions(
    { workspaceId: args.workspaceId, storeIds: args.stores.map((s) => s.id), weekOf: args.weekOf, runId: args.runId },
    deps,
  )) {
    if (event.type === "store_done") built++;
    yield event;
  }
  // A demo-workspace build ends with the Ultra review of what it built (not yielded: the job counts the build's own events).
  if (built && args.workspaceId === DEMO_WORKSPACE_ID) await reviewDemoWorkspace(deps);
}
