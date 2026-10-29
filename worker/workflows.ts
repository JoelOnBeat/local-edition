import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { applyEnvToProcess, setPlatformEnv, type PlatformEnv } from "../src/server/platform/env";
import type { StepLike } from "../src/server/workflows/edition-build";
import { runEditionBuild } from "../src/server/workflows/edition-build";
import { BuildWorkflowParams, type BuildWorkflowInput } from "../src/server/workflows/types";
import { realBuildPorts, realWeeklyPorts } from "../src/server/workflows/wiring";
import { runWeeklyRebuild } from "../src/server/workflows/weekly";

/** Binds the Worker's env for code that runs outside an OpenNext request (every Workflow instance). */
function pin(env: PlatformEnv): void {
  setPlatformEnv(env);
  applyEnvToProcess(env);
}

/**
 * EditionBuild: one retried step per store, calling the existing per-store build, progress events in D1.
 * The logic lives in src/server/workflows/edition-build.ts, tested with a fake step API.
 */
export class EditionBuild extends WorkflowEntrypoint<PlatformEnv, BuildWorkflowInput> {
  async run(event: WorkflowEvent<BuildWorkflowInput>, step: WorkflowStep) {
    pin(this.env);
    return runEditionBuild(step as unknown as StepLike, await realBuildPorts(), BuildWorkflowParams.parse(event.payload));
  }
}

/** WeeklyRebuild: the Monday cron's run: build the demo workspace (Token Factory and Tavily only; it never calls Nebius's control plane). */
export class WeeklyRebuild extends WorkflowEntrypoint<PlatformEnv, BuildWorkflowInput> {
  async run(event: WorkflowEvent<BuildWorkflowInput>, step: WorkflowStep) {
    pin(this.env);
    return runWeeklyRebuild(step as unknown as StepLike, await realWeeklyPorts(), BuildWorkflowParams.parse(event.payload));
  }
}
