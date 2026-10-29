import type {
  Chain,
  Edition,
  EditionItem,
  EditionStatus,
  Evidence,
  JobRun,
  MenuItem,
  StaffCard,
  Store,
  Workspace,
} from "@/contract";

/**
 * Repository interface (stream E implements it: memory, file, kv drivers behind STORE_DRIVER).
 * Every method is async so a Workers KV / D1 driver fits. Isolation is by id: each workspace owns
 * its own chain, so a visitor can only reach rows whose ids they hold.
 */

/** Thrown by `updateEditionItem` when the stored version differs from `expectedVersion`. */
export class VersionConflictError extends Error {
  constructor(
    readonly itemId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Item ${itemId} changed (expected version ${expected}, found ${actual}).`);
    this.name = "VersionConflictError";
  }
}

/** Thrown when an update targets a row that does not exist. */
export class NotFoundError extends Error {
  constructor(readonly kind: string, readonly id: string) {
    super(`${kind} ${id} not found.`);
    this.name = "NotFoundError";
  }
}

export interface WorkspaceSeed {
  chain: Chain;
  stores: Store[];
  menu: MenuItem[];
}

export interface EditionQuery {
  /** Restrict to these stores (a workspace's stores). */
  storeIds: string[];
  /** ISO Monday; omit for the newest edition per store. */
  weekOf?: string;
  /** Skip `drafting` editions: the newest finished one per store (what a new workspace is seeded from). */
  finishedOnly?: boolean;
}

export interface Repo {
  // Workspaces
  /** Atomically create a workspace plus its seeded chain, stores and menu. */
  createWorkspace(seed: WorkspaceSeed): Promise<Workspace>;
  getWorkspace(id: string): Promise<Workspace | null>;
  /** Scans the `ws:` keys (no hot index key); meant for tests and tooling, not a request path. */
  listWorkspaces(): Promise<Workspace[]>;

  // Chains
  getChain(id: string): Promise<Chain | null>;
  putChain(chain: Chain): Promise<Chain>;

  // Stores
  listStores(chainId: string): Promise<Store[]>;
  getStore(id: string): Promise<Store | null>;
  putStore(store: Store): Promise<Store>;
  putStores(stores: Store[]): Promise<Store[]>;
  /** Removes the store and its editions, staff cards and cached profile rows. */
  deleteStore(id: string): Promise<boolean>;

  // Menu items
  listMenu(chainId: string): Promise<MenuItem[]>;
  /** Replace the whole menu for a chain (PUT /api/menu semantics). */
  replaceMenu(chainId: string, items: MenuItem[]): Promise<MenuItem[]>;

  // Editions
  /** Upsert by id; also indexes (storeId, weekOf). */
  putEdition(edition: Edition): Promise<Edition>;
  getEdition(id: string): Promise<Edition | null>;
  getEditionForWeek(storeId: string, weekOf: string): Promise<Edition | null>;
  listEditions(query: EditionQuery): Promise<Edition[]>;
  /**
   * Replace one item if the stored version equals `expectedVersion`; the stored copy gets
   * `version = expectedVersion + 1`. Throws VersionConflictError / NotFoundError.
   */
  updateEditionItem(editionId: string, item: EditionItem, expectedVersion: number): Promise<EditionItem>;
  setEditionStatus(editionId: string, status: EditionStatus): Promise<Edition>;
  /**
   * Version-checked read-modify-write of a whole edition: `mutate` sees the stored row inside the
   * edition's lock (so it can never overwrite a newer write) and may throw to abort. `id`, `storeId`
   * and `weekOf` always keep their stored values. Throws NotFoundError.
   */
  updateEdition(editionId: string, mutate: (current: Edition) => Edition): Promise<Edition>;

  // Evidence (profile and compare evidence; edition evidence also lives inside the Edition)
  putEvidence(items: Evidence[]): Promise<void>;
  getEvidence(ids: string[]): Promise<Evidence[]>;

  // Staff cards
  putStaffCard(card: StaffCard): Promise<StaffCard>;
  getStaffCardByEdition(editionId: string): Promise<StaffCard | null>;
  getStaffCardByToken(token: string): Promise<StaffCard | null>;
  /** Set-if-absent: stores `card` only when the edition has none, and returns whichever card is stored. */
  putStaffCardIfAbsent(card: StaffCard): Promise<StaffCard>;

  // Job runs
  putJobRun(run: JobRun): Promise<JobRun>;
  getJobRun(id: string): Promise<JobRun | null>;
  latestJobRun(): Promise<JobRun | null>;

  // Locks (best effort: exact inside one process, eventually consistent on KV)
  /** Takes the named lock for at most `ttlSeconds`; returns a token, or null when it is held. */
  acquireLock(name: string, ttlSeconds: number): Promise<string | null>;
  releaseLock(name: string, token: string): Promise<void>;

  // Generic TTL cache (Qloo profiles, anchor searches, Tavily results)
  cacheGet<T>(key: string): Promise<T | null>;
  cachePut<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}
