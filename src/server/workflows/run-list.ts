import { MAX_RUNS_LISTED, type RunListItem } from "@/contract";
import type { D1Like } from "../platform/types";
import { RUN_STALE_MS } from "./run-log";

interface RunDbRow { id: string; status: RunListItem["status"]; total: number; done: number; created_at: number; updated_at: number }

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The workspace's runs, newest first, each with its progress and model spend. Two queries however many runs there are: the
 * rows, then the sum of `step_metrics` dollars per run (superseded attempts are not counted: a retried store is billed once in
 * the trace, and its first attempt's calls were replaced). A `running` row nobody has written to for `RUN_STALE_MS` is dead.
 */
export async function listRuns(db: D1Like, workspaceId: string, now: number = Date.now(), limit = MAX_RUNS_LISTED): Promise<RunListItem[]> {
  const rows = (await db
    .prepare("SELECT id, status, total, done, created_at, updated_at FROM build_runs WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .bind(workspaceId, Math.min(limit, MAX_RUNS_LISTED))
    .all<RunDbRow>()).results ?? [];
  if (!rows.length) return [];
  const marks = rows.map(() => "?").join(", ");
  const spend = (await db
    .prepare(
      `SELECT run_id, SUM(json_extract(json, '$.usd')) AS usd FROM build_events
       WHERE workspace_id = ? AND run_id IN (${marks}) AND superseded = 0 AND json_extract(json, '$.type') = 'step_metrics' GROUP BY run_id`)
    .bind(workspaceId, ...rows.map((r) => r.id))
    .all<{ run_id: string; usd: number | null }>()).results ?? [];
  const usdBy = new Map(spend.map((s) => [s.run_id, s.usd ?? 0]));
  return rows.map((r) => ({
    id: r.id,
    status: r.status === "running" && now - r.updated_at > RUN_STALE_MS ? "failed" : r.status,
    total: r.total,
    done: Math.min(r.done, r.total),
    startedAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    usd: Math.max(0, usdBy.get(r.id) ?? 0),
  }));
}
