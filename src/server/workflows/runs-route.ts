import { runsRoutes, type RunsResponse } from "@/contract";
import { wsRoute } from "../handlers/ws";
import { platformEnvSync } from "../platform/env";
import { listRuns } from "./run-list";

/**
 * GET /api/runs: this workspace's run log from D1. Where there is no D1 (dev and tests build in-process and keep no log) the list
 * is empty and the page falls back to the runs its own tab holds.
 */
export const listRunsRoute = wsRoute(runsRoutes.list, async (_input, ctx): Promise<RunsResponse> => {
  const db = platformEnvSync()?.LE_DB;
  return { runs: db ? await listRuns(db, ctx.workspace.id) : [] };
});
