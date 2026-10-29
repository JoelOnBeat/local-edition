import type { AgentDeps } from "./ports";

let override: AgentDeps | undefined;

/** Tests inject fakes for the whole agent; routes then use them. */
export function setAgentDeps(deps: AgentDeps | undefined): void {
  override = deps;
}

/** The agent's dependencies: the injected fakes, else the live wiring (loaded lazily, `live.ts`). */
export async function getAgentDeps(): Promise<AgentDeps> {
  if (override) return override;
  const { liveAgentDeps } = await import("./live");
  return liveAgentDeps();
}
