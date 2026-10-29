import type { Chain, Edition, EditionItem, EditionStatus, Evidence, JobRun, MenuItem, StaffCard, Store, Workspace } from "@/contract";
import { newId } from "@/lib/ids";
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
 * Key layout: ws:<id> · idx:ws · chain:<id> · store:<id> · stores:<chainId> · menu:<chainId> ·
 * ed:<id> · edix:<storeId> ({weekOf: editionId}) · card:<editionId> · cardtok:<token> · ev:<id> ·
 * job:<id> · job:latest · cache:<key>.
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

  private async addToIndex(key: string, ...ids: string[]): Promise<void> {
    await this.locked(key, async () => {
      const list = (await this.read<string[]>(key)) ?? [];
      const next = [...list, ...ids.filter((i) => !list.includes(i))];
      if (next.length !== list.length) await this.kv.put(key, next);
    });
  }

  private async removeFromIndex(key: string, id: string): Promise<void> {
    await this.locked(key, async () => {
      const list = (await this.read<string[]>(key)) ?? [];
      if (list.includes(id)) await this.kv.put(key, list.filter((i) => i !== id));
    });
  }

  // ---- Workspaces
  async createWorkspace(seed: SeedWithId): Promise<Workspace> {
    const id = seed.workspaceId ?? newId("ws");
    if (await this.kv.get(`ws:${id}`)) throw new WorkspaceExistsError(id);
    await this.kv.put(`chain:${seed.chain.id}`, seed.chain);
    await this.putStores(seed.stores);
    await this.kv.put(`menu:${seed.chain.id}`, seed.menu);
    const workspace: Workspace = { id, chainId: seed.chain.id, createdAt: new Date().toISOString() };
    await this.kv.put(`ws:${id}`, workspace); // last: a half-created workspace is unreachable
    await this.addToIndex("idx:ws", id);
    return workspace;
  }
  getWorkspace(id: string) { return this.read<Workspace>(`ws:${id}`); }
  async listWorkspaces(): Promise<Workspace[]> {
    const ids = (await this.read<string[]>("idx:ws")) ?? [];
    const rows = await Promise.all(ids.map((i) => this.getWorkspace(i)));
    return rows.filter((w): w is Workspace => w !== null);
  }

  // ---- Chains
  getChain(id: string) { return this.read<Chain>(`chain:${id}`); }
  async putChain(chain: Chain): Promise<Chain> { await this.kv.put(`chain:${chain.id}`, chain); return chain; }

  // ---- Stores
  async listStores(chainId: string): Promise<Store[]> {
    const ids = (await this.read<string[]>(`stores:${chainId}`)) ?? [];
    const rows = await Promise.all(ids.map((i) => this.getStore(i)));
    return rows.filter((s): s is Store => s !== null);
  }
  getStore(id: string) { return this.read<Store>(`store:${id}`); }
  async putStore(store: Store): Promise<Store> { await this.putStores([store]); return store; }
  async putStores(stores: Store[]): Promise<Store[]> {
    for (const s of stores) await this.kv.put(`store:${s.id}`, s);
    const byChain = new Map<string, string[]>();
    for (const s of stores) byChain.set(s.chainId, [...(byChain.get(s.chainId) ?? []), s.id]);
    for (const [chainId, ids] of byChain) await this.addToIndex(`stores:${chainId}`, ...ids);
    return stores;
  }
  async deleteStore(id: string): Promise<boolean> {
    const store = await this.getStore(id);
    if (!store) return false;
    const index = (await this.read<Record<string, string>>(`edix:${id}`)) ?? {};
    for (const editionId of new Set(Object.values(index))) await this.dropEdition(editionId);
    await this.kv.delete(`edix:${id}`);
    for (const key of await this.kv.list("cache:")) if (key.includes(id)) await this.kv.delete(key);
    await this.removeFromIndex(`stores:${store.chainId}`, id);
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
  async replaceMenu(chainId: string, items: MenuItem[]): Promise<MenuItem[]> { await this.kv.put(`menu:${chainId}`, items); return items; }

  // ---- Editions
  putEdition(edition: Edition): Promise<Edition> {
    return this.locked(`ed:${edition.id}`, async () => {
      await this.kv.put(`ed:${edition.id}`, edition);
      await this.locked(`edix:${edition.storeId}`, async () => {
        const index = (await this.read<Record<string, string>>(`edix:${edition.storeId}`)) ?? {};
        await this.kv.put(`edix:${edition.storeId}`, { ...index, [edition.weekOf]: edition.id });
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
        const weekOf = query.weekOf ?? Object.keys(index).sort().at(-1);
        return weekOf && index[weekOf] ? this.getEdition(index[weekOf]) : null;
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
      await this.kv.put(`ed:${editionId}`, { ...edition, items });
      return stored;
    });
  }
  setEditionStatus(editionId: string, status: EditionStatus): Promise<Edition> {
    return this.locked(`ed:${editionId}`, async () => {
      const edition = await this.getEdition(editionId);
      if (!edition) throw new NotFoundError("Edition", editionId);
      const next = { ...edition, status };
      await this.kv.put(`ed:${editionId}`, next);
      return next;
    });
  }

  // ---- Evidence
  async putEvidence(items: Evidence[]): Promise<void> { for (const e of items) await this.kv.put(`ev:${e.id}`, e); }
  async getEvidence(ids: string[]): Promise<Evidence[]> {
    const rows = await Promise.all(ids.map((i) => this.read<Evidence>(`ev:${i}`)));
    return rows.filter((e): e is Evidence => e !== null);
  }

  // ---- Staff cards
  async putStaffCard(card: StaffCard): Promise<StaffCard> {
    const previous = await this.getStaffCardByEdition(card.editionId);
    if (previous && previous.token !== card.token) await this.kv.delete(`cardtok:${previous.token}`);
    await this.kv.put(`card:${card.editionId}`, card);
    await this.kv.put(`cardtok:${card.token}`, card.editionId);
    return card;
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

  // ---- Cache
  async cacheGet<T>(key: string): Promise<T | null> { return this.read<T>(`cache:${key}`); }
  async cachePut<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.kv.put(`cache:${key}`, value, { ttlSeconds });
  }
}
