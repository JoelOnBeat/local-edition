import { AgentEvent } from "@/contract";
import type { D1Like } from "../platform/types";

/**
 * The persisted side of a Workflow run: one `build_runs` row (status, progress) and an append-only
 * `build_events` log. The Workflow writes events as each store builds; the SSE route tails them by `seq`,
 * so a dropped connection loses nothing (the client reconnects with Last-Event-ID).
 */

/** A `running` run whose last write is older than this is dead (its Workflow was killed). Matches the build lock TTL. */
export const RUN_STALE_MS = 20 * 60 * 1000;

export type RunStatus = "running" | "done" | "failed";

export interface RunRow {
  id: string;
  workspaceId: string;
  status: RunStatus;
  total: number;
  done: number;
  updatedAt: number;
}

export interface LoggedEvent {
  seq: number;
  event: AgentEvent;
}

interface RunDbRow { id: string; workspace_id: string; status: RunStatus; total: number; done: number; updated_at: number }
const toRun = (r: RunDbRow): RunRow => ({ id: r.id, workspaceId: r.workspace_id, status: r.status, total: r.total, done: r.done, updatedAt: r.updated_at });

export class RunLog {
  constructor(private readonly db: D1Like, private readonly now: () => number = Date.now) {}

  /** Registers a run unless the workspace already has a live one. False means 409 `build_running`. */
  async start(runId: string, workspaceId: string, total: number): Promise<boolean> {
    const now = this.now();
    const res = await this.db
      .prepare(
        `INSERT INTO build_runs (id, workspace_id, status, total, done, created_at, updated_at)
         SELECT ?, ?, 'running', ?, 0, ?, ? WHERE NOT EXISTS
           (SELECT 1 FROM build_runs WHERE workspace_id = ? AND status = 'running' AND updated_at > ?)`)
      .bind(runId, workspaceId, total, now, now, workspaceId, now - RUN_STALE_MS)
      .run();
    return (res.meta?.changes ?? 0) === 1;
  }

  async get(runId: string): Promise<RunRow | null> {
    const row = await this.db.prepare("SELECT id, workspace_id, status, total, done, updated_at FROM build_runs WHERE id = ?").bind(runId).first<RunDbRow>();
    return row ? toRun(row) : null;
  }

  /** The workspace's newest run (any status), for a reconnecting client. */
  async latestFor(workspaceId: string): Promise<RunRow | null> {
    const row = await this.db
      .prepare("SELECT id, workspace_id, status, total, done, updated_at FROM build_runs WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(workspaceId)
      .first<RunDbRow>();
    return row ? toRun(row) : null;
  }

  /** Appends one event (seq is assigned in the same statement) and refreshes the run's liveness stamp. */
  async append(runId: string, workspaceId: string, event: AgentEvent): Promise<void> {
    const now = this.now();
    await this.db.batch([
      this.db
        .prepare("INSERT INTO build_events (run_id, seq, workspace_id, json, created_at) SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM build_events WHERE run_id = ?")
        .bind(runId, workspaceId, JSON.stringify(event), now, runId),
      this.db.prepare("UPDATE build_runs SET updated_at = ? WHERE id = ?").bind(now, runId),
    ]);
  }

  async hasEvents(runId: string): Promise<boolean> {
    return (await this.db.prepare("SELECT 1 AS x FROM build_events WHERE run_id = ? LIMIT 1").bind(runId).first()) !== null;
  }

  async setProgress(runId: string, done: number): Promise<void> {
    await this.db.prepare("UPDATE build_runs SET done = ?, updated_at = ? WHERE id = ?").bind(done, this.now(), runId).run();
  }

  async finish(runId: string, status: Exclude<RunStatus, "running">): Promise<void> {
    await this.db.prepare("UPDATE build_runs SET status = ?, updated_at = ? WHERE id = ? AND status = 'running'").bind(status, this.now(), runId).run();
  }

  /** Events after `afterSeq`, oldest first. A row that no longer parses is skipped, never sent. */
  async readFrom(runId: string, afterSeq: number, limit = 200): Promise<LoggedEvent[]> {
    const rows = (await this.db.prepare("SELECT seq, json FROM build_events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?").bind(runId, afterSeq, limit).all<{ seq: number; json: string }>()).results ?? [];
    const out: LoggedEvent[] = [];
    for (const r of rows) {
      const parsed = AgentEvent.safeParse(safeJson(r.json));
      if (parsed.success) out.push({ seq: r.seq, event: parsed.data });
    }
    return out;
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
