import type { Edition } from "@/contract";
import { HttpError } from "../http/errors";
import { createLogger } from "../log";
import { buildLockStub } from "../platform/adapters";
import type { Repo } from "../store/repo";

/**
 * One build per workspace at a time: two interleaved builds wrote over each other's items. The lock expires on its
 * own, so a build whose isolate was killed cannot block the workspace forever. 20 minutes covers a full in-process run.
 * On Workers the BUILD_LOCK Durable Object holds it (exact across isolates); with no binding (dev, tests) the repo does.
 * A bound object that errors fails the call: falling back to the repo lock would let two holders in.
 */
export const BUILD_LOCK_TTL_SECONDS = 20 * 60;
/** A Workflow-owned lock. Every store step takes it again, which extends it, so it outlives a run of any length by one step. */
export const WORKFLOW_LOCK_TTL_SECONDS = 30 * 60;

const log = createLogger("agent:lock");

export interface BuildLock {
  name: string;
  token: string;
  /** Where the lock lives: the workspace's BuildLockDO (exact across isolates) or the repo (best effort). Absent means the repo. */
  backend?: "do";
  /** Held by someone else (an EditionBuild Workflow): the build that was handed it must not release it. */
  borrowed?: boolean;
}

export interface AcquireOptions {
  ttlSeconds?: number;
  /**
   * Names the holder. The lock's token becomes `owner:<owner>`, so the same owner asking again (a retried step, the next
   * store of the same run) extends its own lock instead of finding it taken. Durable Object only: the repo lock is
   * issued a random token, so with no object the owner is ignored.
   */
  owner?: string;
}

const ownerToken = (owner: string) => `owner:${owner}`;
/** Repo-backed owned locks (no Durable Object bound: dev and tests), by workspace and owner. The Durable Object needs no such memory. */
const repoOwned = new Map<string, BuildLock>();
const ownedKey = (workspaceId: string, owner: string) => `${workspaceId}\u0000${owner}`;

/** Takes the workspace's build lock or throws 409 `build_running` (503 `lock_unavailable` when the Durable Object errors). */
export async function acquireBuildLock(repo: Repo, workspaceId: string, opts: AcquireOptions = {}): Promise<BuildLock> {
  const name = `build:${workspaceId}`;
  const ttl = opts.ttlSeconds ?? BUILD_LOCK_TTL_SECONDS;
  const stub = buildLockStub(workspaceId);
  let token: string | null;
  const mine = !stub && opts.owner ? repoOwned.get(ownedKey(workspaceId, opts.owner)) : undefined;
  if (mine) return mine;
  if (stub) {
    try {
      token = await stub.acquire(ttl, opts.owner ? ownerToken(opts.owner) : undefined);
    } catch (e) {
      log.warn("build lock Durable Object unavailable", { err: (e as Error)?.name });
      throw new HttpError(503, "lock_unavailable", "The build lock is unavailable right now. Try again.");
    }
  } else {
    token = await repo.acquireLock(name, ttl);
  }
  if (!token) throw new HttpError(409, "build_running", "A build is already running for this workspace. Wait for it to finish.");
  if (!stub && opts.owner) {
    const lock: BuildLock = { name, token, borrowed: true };
    repoOwned.set(ownedKey(workspaceId, opts.owner), lock);
    return lock;
  }
  return stub ? { name, token, backend: "do" } : { name, token };
}

/** The lock a Workflow's owner holds after `acquireBuildLock(..., { owner })`, rebuilt without a round trip. */
export function ownedBuildLock(workspaceId: string, owner: string): BuildLock {
  return repoOwned.get(ownedKey(workspaceId, owner)) ?? { name: `build:${workspaceId}`, token: ownerToken(owner), backend: "do", borrowed: true };
}

export async function releaseBuildLock(repo: Repo, lock: BuildLock): Promise<void> {
  for (const [key, held] of repoOwned) if (held.token === lock.token && held.name === lock.name) repoOwned.delete(key);
  if (lock.backend === "do") {
    const stub = buildLockStub(lock.name.slice("build:".length));
    if (stub) await stub.release(lock.token).catch(() => undefined);
    return;
  }
  await repo.releaseLock(lock.name, lock.token).catch(() => undefined);
}

/** Approved or hand-edited items are head office's work; a rebuild would silently throw them away. */
export const hasApprovals = (edition: Pick<Edition, "items">): boolean =>
  edition.items.some((i) => i.status === "approved" || i.status === "edited");

/** Thrown inside a version-checked edition write when approvals appeared after the build started. */
export class ApprovalsAppeared extends Error {
  constructor() {
    super("The edition gained approvals while it was being rebuilt.");
    this.name = "ApprovalsAppeared";
  }
}
