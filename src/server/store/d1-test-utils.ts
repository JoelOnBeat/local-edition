import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { D1Like, D1PreparedLike, D1Result } from "../platform/types";

/** All migration files in order, split into single statements (D1 `exec` runs one statement per line, which cannot hold ours). */
export function migrationStatements(root = process.cwd()): string[] {
  const dir = join(root, "migrations");
  const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const TABLES = ["workspaces", "chains", "stores", "menus", "editions", "staff_cards", "evidence", "job_runs", "locks", "cache", "build_runs", "build_events"];

export async function applyMigrations(db: D1Like): Promise<void> {
  await db.batch(migrationStatements().map((s) => db.prepare(s)));
}

export async function wipe(db: D1Like): Promise<void> {
  await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
}

type SqlValue = string | number | null | bigint | Uint8Array;

/**
 * A D1-shaped database over Node's built-in SQLite (`node:sqlite`), the same engine D1 runs. Miniflare's real
 * D1 could not be used: the installed miniflare 5 beta rewrote its config API. `batch` is one transaction
 * (all statements or none), as on D1; `run().meta.changes` reports affected rows.
 */
export async function openTestD1(): Promise<{ db: D1Like; dispose: () => Promise<void> }> {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  type Prepared = D1PreparedLike & { runSync(): D1Result };
  const make = (text: string, params: SqlValue[] = []): Prepared => {
    const runSync = (): D1Result => {
      const r = sqlite.prepare(text).run(...params);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    };
    return {
      bind: (...values) => make(text, values.map((v) => (v === undefined ? null : v)) as SqlValue[]),
      first: async <T>() => (sqlite.prepare(text).get(...params) as T | undefined) ?? null,
      all: async <T>() => ({ results: sqlite.prepare(text).all(...params) as T[], success: true }),
      run: async () => runSync(),
      runSync,
    };
  };
  const db: D1Like = {
    prepare: (text) => make(text),
    // No await between BEGIN and COMMIT, so two batches can never interleave (a D1 batch is atomic).
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const out = (statements as Prepared[]).map((s) => s.runSync());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  await applyMigrations(db);
  return { db, dispose: async () => sqlite.close() };
}
