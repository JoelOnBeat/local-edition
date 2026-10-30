import { z } from "zod";
import type { RouteSpec } from "./route-spec";

/**
 * The workspace's run log, newest first (GET /api/runs). Built from the D1 `build_runs` rows the Workflow writes, so it lists runs
 * that any tab or the Monday cron started, not only the tab that is open. A run's trace replays through the build route's
 * re-attach path (`Last-Event-ID` plus `x-le-run-id`). Not part of `routes`: the typed client reaches it through `call`, like auth.
 */

export const RUN_ID_HEADER = "x-le-run-id";
export const MAX_RUNS_LISTED = 30;

export const RunListItem = z.object({
  id: z.string().min(1).max(64),
  /** `done_with_skips`: finished with a store skipped because a model it needs was unavailable. A `running` run that went quiet reads `failed`. */
  status: z.enum(["running", "done", "done_with_skips", "failed"]),
  /** Stores in the run, and how many have finished. */
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  startedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Model spend of the whole run (the sum of its `step_metrics`), in US dollars. */
  usd: z.number().nonnegative(),
});
export type RunListItem = z.infer<typeof RunListItem>;

export const RunsResponse = z.object({ runs: z.array(RunListItem).max(MAX_RUNS_LISTED) });
export type RunsResponse = z.infer<typeof RunsResponse>;

export const runsRoutes = {
  list: { method: "GET", path: "/api/runs", stream: "E", bodyKind: "none", sse: false, request: z.object({}), response: RunsResponse },
} as const satisfies Record<string, RouteSpec>;
