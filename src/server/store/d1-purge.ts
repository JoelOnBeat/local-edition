import { createLogger } from "../log";
import type { D1Like, D1PreparedLike } from "../platform/types";

const log = createLogger("d1:purge");

/** Expired workspaces removed per batch. A batch is ~10 statements however many workspaces it covers. */
export const PURGE_CHUNK = 500;
/** Batches per run: at most 20 x (1 select + 8 deletes) = 180 queries, far under the 1,000-per-invocation limit. */
export const PURGE_MAX_ROUNDS = 20;
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
export const JOB_RUN_KEEP_MS = 60 * 24 * 3600 * 1000;
const WORKSPACE_TABLES = ["staff_cards", "editions", "stores", "menus", "chains", "build_events", "build_runs"] as const;

/** The same ids in every statement of a batch (the ids are re-selected inside the transaction, ordered, with the same bound `now`). */
const EXPIRED_IDS = "SELECT id FROM workspaces WHERE expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at, id LIMIT ?";

/**
 * Removes expired visitor workspaces and what hangs off them, then the time-limited global rows. A workspace's rows go in
 * a handful of statements per chunk of 500 (each table is deleted by `workspace_id IN (the expired ids)`, which the
 * `*_workspace` indexes serve), so the purge stays inside D1's 1,000 queries per invocation however many expired.
 * `onExpired` runs first with a chunk's ids (the R2 photos); if it throws, that chunk's rows are kept for the next run.
 */
export async function purgeExpiredRows(getDb: () => Promise<D1Like>, now: number, onExpired?: (ids: string[]) => Promise<void>): Promise<number> {
  const db = await getDb();
  const sql = (text: string, ...bind: unknown[]): D1PreparedLike => db.prepare(text).bind(...bind);
  let removed = 0;
  for (let round = 0; round < PURGE_MAX_ROUNDS; round++) {
    const gone = ((await sql(EXPIRED_IDS, now, PURGE_CHUNK).all<{ id: string }>()).results ?? []).map((r) => r.id);
    if (!gone.length) break;
    if (onExpired) {
      try {
        await onExpired(gone);
      } catch (e) {
        log.error("expired-workspace cleanup failed; keeping their rows", { workspaces: gone.length, err: (e as Error)?.name });
        break;
      }
    }
    await db.batch([
      ...WORKSPACE_TABLES.map((t) => sql(`DELETE FROM ${t} WHERE workspace_id IN (${EXPIRED_IDS})`, now, PURGE_CHUNK)),
      sql(`DELETE FROM workspaces WHERE id IN (${EXPIRED_IDS})`, now, PURGE_CHUNK),
    ]);
    removed += gone.length;
    if (gone.length < PURGE_CHUNK) break;
  }
  const oldRuns = now - SEVEN_DAYS_MS;
  await db.batch([
    // Rows written for a parent that vanished meanwhile (a build racing this purge) are stamped `orphan:<parent id>`.
    ...["staff_cards", "editions", "stores", "menus", "chains"].map((t) => sql(`DELETE FROM ${t} WHERE workspace_id LIKE 'orphan:%'`)),
    sql("DELETE FROM evidence WHERE expires_at IS NOT NULL AND expires_at <= ?", now),
    sql("DELETE FROM locks WHERE expires_at <= ?", now),
    sql("DELETE FROM cache WHERE expires_at <= ?", now),
    sql("DELETE FROM build_events WHERE created_at < ?", oldRuns),
    sql("DELETE FROM build_runs WHERE updated_at < ?", oldRuns),
    // `started_at` is an ISO-8601 UTC string, so text order is time order.
    sql("DELETE FROM job_runs WHERE started_at < ?", new Date(now - JOB_RUN_KEEP_MS).toISOString()),
  ]);
  return removed;
}
