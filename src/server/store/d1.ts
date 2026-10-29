import type { Chain, Edition, EditionItem, EditionStatus, Evidence, JobRun, MenuItem, StaffCard, Store, Workspace } from "@/contract";
import { newId, newToken } from "@/lib/ids";
import type { D1Like, D1PreparedLike } from "../platform/types";
import { D1Cache, purgeStoreCaches, type CacheBackend } from "./d1-cache";
import { isVisitorId, VISITOR_TTL_SECONDS } from "./ids";
import { WorkspaceExistsError, type SeedWithId } from "./keyed-repo";
import { NotFoundError, VersionConflictError, type EditionQuery, type Repo } from "./repo";

/**
 * Cloudflare D1 driver (binding `LE_DB`, schema in `migrations/`). Unlike the KV driver its writes are
 * atomic across isolates: an edition write is `UPDATE ... WHERE id = ? AND rev = ?` in a retry loop, and
 * a workspace seed is one `db.batch` (a transaction). Rows of a visitor workspace carry `workspace_id`;
 * the workspace row expires (`expires_at`) and `purgeExpired` (run by the weekly cron) deletes the rest.
 */

const MAX_ATTEMPTS = 8;
const IN_CHUNK = 50;
const j = (v: unknown) => JSON.stringify(v);
const parse = <T>(row: { json: string } | null): T | null => (row ? (JSON.parse(row.json) as T) : null);
const chunks = <T>(list: T[], size = IN_CHUNK): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

export interface D1RepoOptions {
  now?: () => number;
  /** Provider cache backing; defaults to the D1 `cache` table. */
  cache?: CacheBackend;
}

export class D1Repo implements Repo {
  private readonly now: () => number;
  private readonly cache: CacheBackend;

  constructor(private readonly db: () => Promise<D1Like>, opts: D1RepoOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.cache = opts.cache ?? new D1Cache(db, this.now);
  }

  private async sql(text: string, ...bind: unknown[]): Promise<D1PreparedLike> {
    return (await this.db()).prepare(text).bind(...bind);
  }
  private async batch(statements: D1PreparedLike[]): Promise<void> {
    if (statements.length) await (await this.db()).batch(statements);
  }
  private async one<T>(text: string, ...bind: unknown[]): Promise<T | null> {
    return (await this.sql(text, ...bind)).first<T>();
  }
  private async rows<T>(text: string, ...bind: unknown[]): Promise<T[]> {
    return ((await (await this.sql(text, ...bind)).all<T>()).results ?? []) as T[];
  }
  private async changes(text: string, ...bind: unknown[]): Promise<number> {
    return (await (await this.sql(text, ...bind)).run()).meta?.changes ?? 0;
  }

  // ---- Workspaces
  async createWorkspace(seed: SeedWithId): Promise<Workspace> {
    const id = seed.workspaceId ?? newId("ws");
    const db = await this.db();
    const now = this.now();
    const workspace: Workspace = { id, chainId: seed.chain.id, createdAt: new Date(now).toISOString() };
    const expires = isVisitorId(id) ? now + (VISITOR_TTL_SECONDS - 3600) * 1000 : null;
    const ins = (text: string, ...bind: unknown[]) => db.prepare(text).bind(...bind);
    const stores = seed.stores.map((s) => ins("INSERT INTO stores (id, workspace_id, chain_id, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json", s.id, id, s.chainId, j(s)));
    try {
      await db.batch([
        // An expired row with this id is dead; clear it so the id can be reused.
        ins("DELETE FROM workspaces WHERE id = ? AND expires_at IS NOT NULL AND expires_at <= ?", id, now),
        ins("INSERT INTO workspaces (id, chain_id, created_at, expires_at) VALUES (?, ?, ?, ?)", id, workspace.chainId, workspace.createdAt, expires),
        ins("INSERT INTO chains (id, workspace_id, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json", seed.chain.id, id, j(seed.chain)),
        ...stores,
        ins("INSERT INTO menus (chain_id, workspace_id, json) VALUES (?, ?, ?) ON CONFLICT(chain_id) DO UPDATE SET json = excluded.json", seed.chain.id, id, j(seed.menu)),
      ]);
    } catch (e) {
      if (/UNIQUE|constraint/i.test(String((e as Error)?.message))) throw new WorkspaceExistsError(id);
      throw e;
    }
    return workspace;
  }
  async getWorkspace(id: string): Promise<Workspace | null> {
    const row = await this.one<{ id: string; chain_id: string; created_at: string }>(
      "SELECT id, chain_id, created_at FROM workspaces WHERE id = ? AND (expires_at IS NULL OR expires_at > ?)", id, this.now());
    return row ? { id: row.id, chainId: row.chain_id, createdAt: row.created_at } : null;
  }
  async listWorkspaces(): Promise<Workspace[]> {
    const rows = await this.rows<{ id: string; chain_id: string; created_at: string }>(
      "SELECT id, chain_id, created_at FROM workspaces WHERE expires_at IS NULL OR expires_at > ? ORDER BY rowid", this.now());
    return rows.map((r) => ({ id: r.id, chainId: r.chain_id, createdAt: r.created_at }));
  }

  // ---- Chains
  async getChain(id: string) { return parse<Chain>(await this.one("SELECT json FROM chains WHERE id = ?", id)); }
  async putChain(chain: Chain): Promise<Chain> {
    await this.changes(
      "INSERT INTO chains (id, workspace_id, json) VALUES (?, COALESCE((SELECT id FROM workspaces WHERE chain_id = ?), ''), ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
      chain.id, chain.id, j(chain));
    return chain;
  }

  // ---- Stores
  async listStores(chainId: string): Promise<Store[]> {
    return (await this.rows<{ json: string }>("SELECT json FROM stores WHERE chain_id = ? ORDER BY rowid", chainId)).map((r) => JSON.parse(r.json) as Store);
  }
  async getStore(id: string) { return parse<Store>(await this.one("SELECT json FROM stores WHERE id = ?", id)); }
  async putStore(store: Store): Promise<Store> { await this.putStores([store]); return store; }
  async putStores(stores: Store[]): Promise<Store[]> {
    await this.batch(await Promise.all(stores.map((s) => this.sql(
      "INSERT INTO stores (id, workspace_id, chain_id, json) VALUES (?, COALESCE((SELECT workspace_id FROM chains WHERE id = ?), ''), ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, chain_id = excluded.chain_id",
      s.id, s.chainId, s.chainId, j(s)))));
    return stores;
  }
  async deleteStore(id: string): Promise<boolean> {
    if (!(await this.getStore(id))) return false;
    await this.batch([
      await this.sql("DELETE FROM staff_cards WHERE edition_id IN (SELECT id FROM editions WHERE store_id = ?)", id),
      await this.sql("DELETE FROM editions WHERE store_id = ?", id),
      await this.sql("DELETE FROM stores WHERE id = ?", id),
    ]);
    await purgeStoreCaches(this.cache, (ids) => this.deleteEvidence(ids), id);
    return true;
  }
  private async deleteEvidence(ids: string[]): Promise<void> {
    await this.batch(await Promise.all(chunks(ids).map((c) => this.sql(`DELETE FROM evidence WHERE id IN (${marks(c.length)})`, ...c))));
  }

  // ---- Menu
  async listMenu(chainId: string): Promise<MenuItem[]> { return parse<MenuItem[]>(await this.one("SELECT json FROM menus WHERE chain_id = ?", chainId)) ?? []; }
  async replaceMenu(chainId: string, items: MenuItem[]): Promise<MenuItem[]> {
    await this.changes(
      "INSERT INTO menus (chain_id, workspace_id, json) VALUES (?, COALESCE((SELECT workspace_id FROM chains WHERE id = ?), ''), ?) ON CONFLICT(chain_id) DO UPDATE SET json = excluded.json",
      chainId, chainId, j(items));
    return items;
  }

  // ---- Editions
  async putEdition(edition: Edition): Promise<Edition> {
    await this.batch([
      // One edition per (store, week): a different id for the same slot replaces the old row and its card.
      await this.sql("DELETE FROM staff_cards WHERE edition_id IN (SELECT id FROM editions WHERE store_id = ? AND week_of = ? AND id <> ?)", edition.storeId, edition.weekOf, edition.id),
      await this.sql("DELETE FROM editions WHERE store_id = ? AND week_of = ? AND id <> ?", edition.storeId, edition.weekOf, edition.id),
      await this.sql(
        `INSERT INTO editions (id, workspace_id, store_id, week_of, status, rev, json)
         VALUES (?, COALESCE((SELECT workspace_id FROM stores WHERE id = ?), ''), ?, ?, ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET store_id = excluded.store_id, week_of = excluded.week_of, status = excluded.status, json = excluded.json, rev = editions.rev + 1`,
        edition.id, edition.storeId, edition.storeId, edition.weekOf, edition.status, j(edition)),
    ]);
    return edition;
  }
  async getEdition(id: string) { return parse<Edition>(await this.one("SELECT json FROM editions WHERE id = ?", id)); }
  async getEditionForWeek(storeId: string, weekOf: string) { return parse<Edition>(await this.one("SELECT json FROM editions WHERE store_id = ? AND week_of = ?", storeId, weekOf)); }
  async listEditions(query: EditionQuery): Promise<Edition[]> {
    const found = new Map<string, { week: string; edition: Edition }>();
    for (const ids of chunks(query.storeIds)) {
      const where = [`store_id IN (${marks(ids.length)})`];
      const bind: unknown[] = [...ids];
      if (query.weekOf) { where.push("week_of = ?"); bind.push(query.weekOf); }
      if (query.finishedOnly) where.push("status <> 'drafting'");
      for (const r of await this.rows<{ store_id: string; week_of: string; json: string }>(
        `SELECT store_id, week_of, json FROM editions WHERE ${where.join(" AND ")} ORDER BY week_of DESC`, ...bind)) {
        if (!found.has(r.store_id)) found.set(r.store_id, { week: r.week_of, edition: JSON.parse(r.json) as Edition });
      }
    }
    return query.storeIds.flatMap((id) => (found.has(id) ? [found.get(id)!.edition] : []));
  }

  /** Optimistic read-modify-write: re-reads and re-applies `mutate` when another writer got in first. */
  private async cas(editionId: string, mutate: (current: Edition, rev: number) => Edition): Promise<Edition> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const row = await this.one<{ json: string; rev: number }>("SELECT json, rev FROM editions WHERE id = ?", editionId);
      if (!row) throw new NotFoundError("Edition", editionId);
      const current = JSON.parse(row.json) as Edition;
      const next: Edition = { ...mutate(structuredClone(current), row.rev), id: current.id, storeId: current.storeId, weekOf: current.weekOf };
      if ((await this.changes("UPDATE editions SET json = ?, status = ?, rev = rev + 1 WHERE id = ? AND rev = ?", j(next), next.status, editionId, row.rev)) === 1) return next;
    }
    throw new Error(`Edition ${editionId} is too busy to update.`);
  }
  updateEditionItem(editionId: string, item: EditionItem, expectedVersion: number): Promise<EditionItem> {
    let stored: EditionItem | undefined;
    return this.cas(editionId, (edition) => {
      const at = edition.items.findIndex((i) => i.id === item.id);
      if (at === -1) throw new NotFoundError("Item", item.id);
      const actual = edition.items[at].version;
      if (actual !== expectedVersion) throw new VersionConflictError(item.id, expectedVersion, actual);
      stored = { ...item, version: expectedVersion + 1 } as EditionItem;
      const items = edition.items.slice();
      items[at] = stored;
      return { ...edition, items };
    }).then(() => stored!);
  }
  setEditionStatus(editionId: string, status: EditionStatus): Promise<Edition> { return this.cas(editionId, (cur) => ({ ...cur, status })); }
  updateEdition(editionId: string, mutate: (current: Edition) => Edition): Promise<Edition> { return this.cas(editionId, (cur) => mutate(cur)); }

  // ---- Evidence
  async putEvidence(items: Evidence[]): Promise<void> {
    const expires = this.now() + VISITOR_TTL_SECONDS * 1000;
    await this.batch(await Promise.all(items.map((e) => this.sql(
      "INSERT INTO evidence (id, json, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at", e.id, j(e), expires))));
  }
  async getEvidence(ids: string[]): Promise<Evidence[]> {
    const byId = new Map<string, Evidence>();
    for (const c of chunks([...new Set(ids)])) {
      for (const r of await this.rows<{ id: string; json: string }>(`SELECT id, json FROM evidence WHERE id IN (${marks(c.length)}) AND (expires_at IS NULL OR expires_at > ?)`, ...c, this.now())) byId.set(r.id, JSON.parse(r.json) as Evidence);
    }
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  // ---- Staff cards
  async putStaffCard(card: StaffCard): Promise<StaffCard> {
    await this.changes(
      `INSERT INTO staff_cards (edition_id, workspace_id, token, json)
       VALUES (?, COALESCE((SELECT workspace_id FROM editions WHERE id = ?), ''), ?, ?)
       ON CONFLICT(edition_id) DO UPDATE SET token = excluded.token, json = excluded.json`,
      card.editionId, card.editionId, card.token, j(card));
    return card;
  }
  async putStaffCardIfAbsent(card: StaffCard): Promise<StaffCard> {
    await this.changes(
      `INSERT OR IGNORE INTO staff_cards (edition_id, workspace_id, token, json)
       VALUES (?, COALESCE((SELECT workspace_id FROM editions WHERE id = ?), ''), ?, ?)`,
      card.editionId, card.editionId, card.token, j(card));
    return (await this.getStaffCardByEdition(card.editionId)) ?? card;
  }
  async getStaffCardByEdition(editionId: string) { return parse<StaffCard>(await this.one("SELECT json FROM staff_cards WHERE edition_id = ?", editionId)); }
  async getStaffCardByToken(token: string) { return parse<StaffCard>(await this.one("SELECT json FROM staff_cards WHERE token = ?", token)); }

  // ---- Job runs
  async putJobRun(run: JobRun): Promise<JobRun> {
    await this.changes("INSERT INTO job_runs (id, started_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json", run.id, run.startedAt, j(run));
    return run;
  }
  async getJobRun(id: string) { return parse<JobRun>(await this.one("SELECT json FROM job_runs WHERE id = ?", id)); }
  async latestJobRun() { return parse<JobRun>(await this.one("SELECT json FROM job_runs ORDER BY started_at DESC, rowid DESC LIMIT 1")); }

  // ---- Locks (exact: one conditional upsert)
  async acquireLock(name: string, ttlSeconds: number): Promise<string | null> {
    const token = newToken();
    const now = this.now();
    const changed = await this.changes(
      "INSERT INTO locks (name, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE locks.expires_at <= ?",
      name, token, now + ttlSeconds * 1000, now);
    return changed === 1 ? token : null;
  }
  async releaseLock(name: string, token: string): Promise<void> { await this.changes("DELETE FROM locks WHERE name = ? AND token = ?", name, token); }

  // ---- Cache
  async cacheGet<T>(key: string): Promise<T | null> { return ((await this.cache.get(key)) as T | null) ?? null; }
  async cachePut<T>(key: string, value: T, ttlSeconds: number): Promise<void> { await this.cache.put(key, value, ttlSeconds); }

  /** Deletes expired visitor workspaces with everything under them, plus expired evidence, locks, cache and old build runs. Returns the workspaces removed. */
  async purgeExpired(): Promise<number> {
    const now = this.now();
    const gone = await this.rows<{ id: string; chain_id: string }>("SELECT id, chain_id FROM workspaces WHERE expires_at IS NOT NULL AND expires_at <= ?", now);
    const oldRuns = now - 7 * 24 * 3600 * 1000;
    const statements: D1PreparedLike[] = [];
    for (const w of gone) {
      for (const table of ["staff_cards", "editions", "stores", "menus", "chains", "build_events", "build_runs"]) statements.push(await this.sql(`DELETE FROM ${table} WHERE workspace_id = ?`, w.id));
      statements.push(await this.sql("DELETE FROM workspaces WHERE id = ?", w.id));
    }
    statements.push(
      await this.sql("DELETE FROM evidence WHERE expires_at IS NOT NULL AND expires_at <= ?", now),
      await this.sql("DELETE FROM locks WHERE expires_at <= ?", now),
      await this.sql("DELETE FROM cache WHERE expires_at <= ?", now),
      await this.sql("DELETE FROM build_events WHERE created_at < ?", oldRuns),
      await this.sql("DELETE FROM build_runs WHERE updated_at < ?", oldRuns),
    );
    await this.batch(statements);
    return gone.length;
  }
}

export function createD1Repo(db: () => Promise<D1Like>, opts: D1RepoOptions = {}): D1Repo {
  return new D1Repo(db, opts);
}
