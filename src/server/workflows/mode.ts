import { inProduction, platformEnvSync } from "../platform/env";

/**
 * Production starts the EditionBuild Workflow; `next dev` (where Workflows are not simulated) and tests run
 * the build inline as before. `BUILD_MODE=inline` forces the old path anywhere; `BUILD_MODE=workflow` uses the
 * Workflow whenever it is bound (for `wrangler dev`, which does simulate it). Either way the binding must exist.
 */
export function useWorkflow(): boolean {
  const mode = process.env.BUILD_MODE;
  if (mode === "inline") return false;
  const env = platformEnvSync();
  const bound = Boolean(env?.EDITION_BUILD && env.LE_DB);
  return bound && (mode === "workflow" || inProduction());
}
