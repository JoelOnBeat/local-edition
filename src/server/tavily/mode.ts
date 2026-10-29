import type { ProviderMode } from "@/contract";
import type { ServerEnv } from "@/lib/env";
import type { ProviderRunMode } from "../http/fetch-json";

export interface TavilyModeState {
  /** How fetchJson runs: live calls out, replay reads recordings, fixture uses fixtures only. */
  run: ProviderRunMode;
  /** What /api/status reports for Tavily. */
  status: ProviderMode;
}

/**
 * Live needs the key. Without it the status reads `missing-key` and the run falls back to
 * replay (which itself falls back to the fixture when no recording exists).
 */
export function tavilyModeFor(env: Pick<ServerEnv, "TAVILY_MODE" | "TAVILY_API_KEY">): TavilyModeState {
  if (env.TAVILY_MODE === "live") {
    return env.TAVILY_API_KEY ? { run: "live", status: "live" } : { run: "replay", status: "missing-key" };
  }
  return { run: env.TAVILY_MODE, status: env.TAVILY_MODE };
}
