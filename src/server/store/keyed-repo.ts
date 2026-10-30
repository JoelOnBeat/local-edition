import type { Chain, Edition, EditionItem, EditionStatus, Evidence, JobRun, MenuItem, StaffCard, Store, Workspace } from "@/contract";
import { newId, newToken } from "@/lib/ids";
import { isVisitorId, VISITOR_TTL_SECONDS } from "./ids";
import { purgeStoreCaches } from "./purge";
import {
  NotFoundError,
  VersionConflictError,
  type EditionQuery,
  type Repo,
  type WorkspaceSeed,
} from "./repo";

/**
 * One Repo implementation over a tiny JSON key-value interface. Memory, file and Cloudflare KV are
 * three backings of the same logic, so all drivers behave identically (and share one contract test).
 *
 * Key layout: ws:<id> · chain:<id> · store:<id> · stores:<chainId> · menu:<chainId> ·
 * ed:<id> · edix:<storeId> ({weekOf: editionId}) · card:<editionId> · cardtok:<token> · ev:<id> ·
 * job:<id> · job:latest · cache:<key> · lock:<name>.
 *
 * Rows that belong to a visitor workspace (ids `ws_…` or `…~suffix`) get a TTL, so abandoned visitors
 * clean themselves up; the demo workspace never expires. There is no workspace index key (a single hot
 * key cannot take bursts of new visitors on KV): `listWorkspaces` scans `ws:`.
 */

export interface KvLike {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown, opts?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys starting with `prefix` (small sets only: cache purge on store delete). */
  list(prefix: string): Promise<string[]>;
}

/** Thrown by `createWorkspace` when the workspace id is already taken. */
export class WorkspaceExistsError extends Error {
  constructor(readonly id: string) {
    super(`Workspace ${id} already exists.`);
    this.name = "WorkspaceExistsError";
  }
}

export type SeedWithId = WorkspaceSeed & { workspaceId?: string };

export class KeyedRepo implements Repo {
  private locks = new Map<string, Promise<void>>();

  constructor(private readonly kv: KvLike) {}

  /** Serialises read-modify-write on one key inside this process (KV itself has no transactions). */
  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(() => undefined, () => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private async read<T>(key: string): Promise<T | null> {
    return ((await this.kv.get(key)) as T | null) ?? null;
  }

  /** Writes a row; rows owned by a visitor workspace expire (`owner` is the id the row hangs off). */
  private put(key: string, value: unknown, owner?: string): Promise<void> {
    const ttlSeconds = owner !== undefined && isVisitorId(owner) ? VISITOR_TTL_SECONDS : undefined;
    return this.kv.put(key, value, ttlSeconds === undefined ? undefined : { ttlSeconds });
  }

  private async addToIndex(key: string, owner: string, ...ids: string[]): Promise<void> {
    await this.locked(key, async () => {
      const list = (await this.read<string[]>(key)) ?? [];
      const next = [...list, ...ids.filter((i) => !list.includes(i))];
      if (next.length !== list.length) await this.put(key, next, owner);
    });
  }

  private async removeFromIndex(key: string, owner: string, id: string): Promise<void> {
    await this.locked(key, async () => {
      const list = (await this.read<string[]>(key)) ?? [];
      if (list.includes(id)) await this.put(key, list.filter((i) => i !== id), owner);
    });
  }

  // ---- Workspaces
  async createWorkspace(seed: SeedWithId): Promise<Workspace> {
    const id = seed.workspaceId ?? newId("ws");
    if (await this.kv.get(`ws:${id}`)) throw new WorkspaceExistsError(id);
    await this.put(`chain:${seed.chain.id}`, seed.chain, seed.chain.id);
    await this.putStores(seed.stores);
    await this.put(`menu:${seed.chain.id}`, seed.menu, seed.chain.id);
    const workspace: Workspace = { id, chainId: seed.chain.id, createdAt: new Date().toISOString() };
    // Last, so a half-created workspace is unreachable; it also expires first, an hour before its rows.
    await this.kv.put(`ws:${id}`, workspace, isVisitorId(id) ? { ttlSeconds: VISITOR_TTL_SECONDS - 3600 } : undefined);
    return workspace;
  }
  getWorkspace(id: string) { return this.read<Workspace>(`ws:${id}`); }
  async deleteWorkspace(id: string): Promise<boolean> {
    const workspace = await this.getWorkspace(id);
    if (!workspace) return false;
    for (const store of await this.listStores(workspace.chainId)) await this.deleteStore(store.id);
    await this.kv.delete(`stores:${workspace.chainId}`);
    await this.kv.delete(`menu:${workspace.chainId}`);
    await this.kv.delete(`chain:${workspace.chainId}`);
    await this.kv.delete(`ws:${id}`);
    return true;
  }
  async listWorkspaces(): Promise<Workspace[]> {
    const keys = await this.kv.list("ws:");
    const rows = await Promise.all(keys.map((k) => this.getWorkspace(k.slice(3))));
    return rows.filter((w): w is Workspace => w !== null);
  }

  // ---- Chains
  getChain(id: string) { return this.read<Chain>(`chain:${id}`); }
  async putChain(chain: Chain): Promise<Chain> { await this.put(`chain:${chain.id}`, chain, chain.id); return chain; }

  // ---- Stores
  async listStores(chainId: string): Promise<Store[]> {
    const ids = (await this.read<string[]>(`stores:${chainId}`)) ?? [];
    const rows = await Promise.all(ids.map((i) => this.getStore(i)));
    return rows.filter((s): s is Store => s !== null);
  }
  getStore(id: string) { return this.read<Store>(`store:${id}`); }
  async putStore(store: Store): Promise<Store> { await this.putStores([store]); return store; }
  async putStores(stores: Store[]): Promise<Store[]> {
    for (const s of stores) await this.put(`store:${s.id}`, s, s.id);
    const byChain = new Map<string, string[]>();
    for (const s of stores) byChain.set(s.chainId, [...(byChain.get(s.chainId) ?? []), s.id]);
    for (const [chainId, ids] of byChain) await this.addToIndex(`stores:${chainId}`, chainId, ...ids);
    return stores;
  }
  async deleteStore(id: string): Promise<boolean> {
    const store = await this.getStore(id);
    if (!store) return false;
    const index = (await this.read<Record<string, string>>(`edix:${id}`)) ?? {};
    for (const editionId of new Set(Object.values(index))) await this.dropEdition(editionId);
    await this.kv.delete(`edix:${id}`);
    await purgeStoreCaches(this.kv, id);
    await this.removeFromIndex(`stores:${store.chainId}`, store.chainId, id);
    await this.kv.delete(`store:${id}`);
    return true;
  }
  private async dropEdition(editionId: string): Promise<void> {
    const card = await this.getStaffCardByEdition(editionId);
    if (card) await this.kv.delete(`cardtok:${card.token}`);
    await this.kv.delete(`card:${editionId}`);
    await this.kv.delete(`ed:${editionId}`);
  }

  // ---- Menu
  async listMenu(chainId: string): Promise<MenuItem[]> { return (await this.read<MenuItem[]>(`menu:${chainId}`)) ?? []; }
  async replaceMenu(chainId: string, items: MenuItem[]): Promise<MenuItem[]> { await this.put(`menu:${chainId}`, items, chainId); return items; }

  // ---- Editions
  putEdition(edition: Edition): Promise<Edition> {
    return this.locked(`ed:${edition.id}`, async () => {
      await this.put(`ed:${edition.id}`, edition, edition.id);
      await this.locked(`edix:${edition.storeId}`, async () => {
        const index = (await this.read<Record<string, string>>(`edix:${edition.storeId}`)) ?? {};
        await this.put(`edix:${edition.storeId}`, { ...index, [edition.weekOf]: edition.id }, edition.storeId);
      });
      return edition;
    });
  }
  getEdition(id: string) { return this.read<Edition>(`ed:${id}`); }
  async getEditionForWeek(storeId: string, weekOf: string): Promise<Edition | null> {
    const index = (await this.read<Record<string, string>>(`edix:${storeId}`)) ?? {};
    return index[weekOf] ? this.getEdition(index[weekOf]) : null;
  }
  async listEditions(query: EditionQuery): Promise<Edition[]> {
    const found = await Promise.all(
      query.storeIds.map(async (storeId) => {
        const index = (await this.read<Record<string, string>>(`edix:${storeId}`)) ?? {};
        const weeks = query.weekOf ? [query.weekOf] : Object.keys(index).sort().reverse();
        for (const weekOf of query.finishedOnly ? weeks : weeks.slice(0, 1)) {
          const edition = index[weekOf] ? await this.getEdition(index[weekOf]) : null;
          if (edition && !(query.finishedOnly && edition.status === "drafting")) return edition;
        }
        return null;
      }),
    );
    return found.filter((e): e is Edition => e !== null);
  }
  updateEditionItem(editionId: string, item: EditionItem, expectedVersion: number): Promise<EditionItem> {
    return this.locked(`ed:${editionId}`, async () => {
      const edition = await this.getEdition(editionId);
      if (!edition) throw new NotFoundError("Edition", editionId);
      const at = edition.items.findIndex((i) => i.id === item.id);
      if (at === -1) throw new NotFoundError("Item", item.id);
      const actual = edition.items[at].version;
      if (actual !== expectedVersion) throw new VersionConflictError(item.id, expectedVersion, actual);
      const stored = { ...item, version: expectedVersion + 1 } as EditionItem;
      const items = edition.items.slice();
      items[at] = stored;
      await this.put(`ed:${editionId}`, { ...edition, items }, editionId);
      return stored;
    });
  }
  setEditionStatus(editionId: string, status: EditionStatus): Promise<Edition> {
    return this.locked(`ed:${editionId}`, async () => {
      const edition = await this.getEdition(editionId);
      if (!edition) throw new NotFoundError("Edition", editionId);
      const next = { ...edition, status };
      await this.put(`ed:${editionId}`, next, editionId);
      return next;
    });
  }
  updateEdition(editionId: string, mutate: (current: Edition) => Edition): Promise<Edition> {
    return this.locked(`ed:${editionId}`, async () => {
      const current = await this.getEdition(editionId);
      if (!current) throw new NotFoundError("Edition", editionId);
      const next: Edition = { ...mutate(structuredClone(current)), id: current.id, storeId: current.storeId, weekOf: current.weekOf };
      await this.put(`ed:${editionId}`, next, editionId);
      return next;
    });
  }

  // ---- Evidence
  async putEvidence(items: Evidence[]): Promise<void> {
    for (const e of items) await this.kv.put(`ev:${e.id}`, e, { ttlSeconds: VISITOR_TTL_SECONDS });
  }
  async getEvidence(ids: string[]): Promise<Evidence[]> {
    const rows = await Promise.all(ids.map((i) => this.read<Evidence>(`ev:${i}`)));
    return rows.filter((e): e is Evidence => e !== null);
  }

  // ---- Staff cards
  async putStaffCard(card: StaffCard): Promise<StaffCard> {
    const previous = await this.getStaffCardByEdition(card.editionId);
    if (previous && previous.token !== card.token) await this.kv.delete(`cardtok:${previous.token}`);
    await this.put(`card:${card.editionId}`, card, card.editionId);
    await this.put(`cardtok:${card.token}`, card.editionId, card.editionId);
    return card;
  }
  putStaffCardIfAbsent(card: StaffCard): Promise<StaffCard> {
    return this.locked(`card:${card.editionId}`, async () => {
      const existing = await this.getStaffCardByEdition(card.editionId);
      if (existing) return existing;
      await this.put(`card:${card.editionId}`, card, card.editionId);
      await this.put(`cardtok:${card.token}`, card.editionId, card.editionId);
      return card;
    });
  }
  getStaffCardByEdition(editionId: string) { return this.read<StaffCard>(`card:${editionId}`); }
  async getStaffCardByToken(token: string): Promise<StaffCard | null> {
    const editionId = await this.read<string>(`cardtok:${token}`);
    const card = editionId ? await this.getStaffCardByEdition(editionId) : null;
    return card && card.token === token ? card : null;
  }

  // ---- Job runs
  async putJobRun(run: JobRun): Promise<JobRun> {
    await this.kv.put(`job:${run.id}`, run);
    const latest = await this.latestJobRun();
    if (!latest || latest.id === run.id || run.startedAt >= latest.startedAt) await this.kv.put("job:latest", run.id);
    return run;
  }
  getJobRun(id: string) { return this.read<JobRun>(`job:${id}`); }
  async latestJobRun(): Promise<JobRun | null> {
    const id = await this.read<string>("job:latest");
    return id ? this.getJobRun(id) : null;
  }

  // ---- Locks
  acquireLock(name: string, ttlSeconds: number): Promise<string | null> {
    return this.locked(`lock:${name}`, async () => {
      if (await this.read(`lock:${name}`)) return null;
      const token = newToken();
      await this.kv.put(`lock:${name}`, { token }, { ttlSeconds });
      return token;
    });
  }
  releaseLock(name: string, token: string): Promise<void> {
    return this.locked(`lock:${name}`, async () => {
      const held = await this.read<{ token: string }>(`lock:${name}`);
      if (held?.token === token) await this.kv.delete(`lock:${name}`);
    });
  }

  // ---- Cache
  async cacheGet<T>(key: string): Promise<T | null> { return this.read<T>(`cache:${key}`); }
  async cachePut<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.kv.put(`cache:${key}`, value, { ttlSeconds });
  }
}
