import type { BuildArgs, BuildEditions, JobPorts } from "./ports";
import { runInBackground } from "./background";
import { getOverrides } from "./ports";

/**
 * Connects stream C's edition agent to the Monday job. Only the job route imports this file, so only
 * that route compiles the agent's dependency tree (Qloo, Tavily, Token Factory). Tests inject fakes
 * with `setPorts` and never reach the real agent.
 */
const realBuild: BuildEditions = async function* (args: BuildArgs) {
  const { buildEditionsForJob } = await import("../agent/job-adapter");
  yield* buildEditionsForJob(args);
};

export async function getJobPorts(): Promise<JobPorts> {
  const o = getOverrides();
  return { buildEditions: o.buildEditions ?? realBuild, background: o.background ?? runInBackground };
}
