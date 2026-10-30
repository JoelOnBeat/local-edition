import type { D1Like } from "../../platform/types";
import { platformEnv } from "../../platform/env";

/** The tiny document layer under the typed comms store: D1 in production, memory in tests and `next dev` without a binding. */

export interface DocRow {
  workspaceId: string;
  kind: string;
  key: string;
  ref: string | null;
  json: string;
  at: string;
}

export interface DocDb {
  put(row: DocRow): Promise<void>;
  get(workspaceId: string, kind: string, key: string): Promise<DocRow | null>;
  /** Newest first by `at`. */
  list(workspaceId: string, kind: string, limit: number): Promise<DocRow[]>;
  findByRef(kind: string, ref: string): Promise<DocRow | null>;
  delete(workspaceId: string, kind: string, key?: string): Promise<void>;
  /** True the first time `key` is claimed; false when it already was (or is held). */
  claim(key: string, nowMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export function createMemoryDocDb(): DocDb {
  const rows = new Map<string, DocRow>();
  const claims = new Set<string>();
  const id = (w: string, k: string, key: string) => `${w}\u0000${k}\u0000${key}`;
  return {
    async put(row) { rows.set(id(row.workspaceId, row.kind, row.key), { ...row }); },
    async get(w, k, key) { return rows.get(id(w, k, key)) ?? null; },
    async list(w, k, limit) {
      return [...rows.values()].filter((r) => r.workspaceId === w && r.kind === k).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    },
    async findByRef(kind, ref) { return [...rows.values()].find((r) => r.kind === kind && r.ref === ref) ?? null; },
    async delete(w, k, key) {
      for (const [name, r] of rows) if (r.workspaceId === w && r.kind === k && (key === undefined || r.key === key)) rows.delete(name);
    },
    async claim(key) { if (claims.has(key)) return false; claims.add(key); return true; },
    async release(key) { claims.delete(key); },
  };
}

interface Raw { workspace_id: string; kind: string; key: string; ref: string | null; json: string; at: string }
const fromRaw = (r: Raw): DocRow => ({ workspaceId: r.workspace_id, kind: r.kind, key: r.key, ref: r.ref, json: r.json, at: r.at });

export function createD1DocDb(db: D1Like): DocDb {
  return {
    async put(r) {
      await db.prepare("INSERT INTO comms_docs (workspace_id, kind, key, ref, json, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, kind, key) DO UPDATE SET ref = excluded.ref, json = excluded.json, at = excluded.at")
        .bind(r.workspaceId, r.kind, r.key, r.ref, r.json, r.at).run();
    },
    async get(w, k, key) {
      const r = await db.prepare("SELECT * FROM comms_docs WHERE workspace_id = ? AND kind = ? AND key = ?").bind(w, k, key).first<Raw>();
      return r ? fromRaw(r) : null;
    },
    async list(w, k, limit) {
      const res = await db.prepare("SELECT * FROM comms_docs WHERE workspace_id = ? AND kind = ? ORDER BY at DESC LIMIT ?").bind(w, k, limit).all<Raw>();
      return (res.results ?? []).map(fromRaw);
    },
    async findByRef(kind, ref) {
      const r = await db.prepare("SELECT * FROM comms_docs WHERE kind = ? AND ref = ? LIMIT 1").bind(kind, ref).first<Raw>();
      return r ? fromRaw(r) : null;
    },
    async delete(w, k, key) {
      if (key === undefined) await db.prepare("DELETE FROM comms_docs WHERE workspace_id = ? AND kind = ?").bind(w, k).run();
      else await db.prepare("DELETE FROM comms_docs WHERE workspace_id = ? AND kind = ? AND key = ?").bind(w, k, key).run();
    },
    async claim(key, nowMs) {
      const res = await db.prepare("INSERT OR IGNORE INTO comms_claims (key, at) VALUES (?, ?)").bind(key, nowMs).run();
      return (res.meta?.changes ?? 0) > 0;
    },
    async release(key) { await db.prepare("DELETE FROM comms_claims WHERE key = ?").bind(key).run(); },
  };
}

const slot = globalThis as typeof globalThis & { __leCommsDocs?: DocDb };

/** D1 when `LE_DB` is bound (not cached: the binding belongs to the current invocation), else one in-memory db per process. Tests inject their own with `setDocDb`. */
export async function getDocDb(): Promise<DocDb> {
  if (slot.__leCommsDocs) return slot.__leCommsDocs;
  const env = await platformEnv({ allowDevProxy: process.env.STORE_DRIVER === "d1" });
  if (env?.LE_DB) return createD1DocDb(env.LE_DB);
  if (process.env.NODE_ENV === "production") throw new Error("The comms store needs the LE_DB binding.");
  slot.__leCommsDocs = createMemoryDocDb();
  return slot.__leCommsDocs;
}

export function setDocDb(db: DocDb | undefined): void {
  slot.__leCommsDocs = db;
}
