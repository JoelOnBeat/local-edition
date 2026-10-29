import type { Edition } from "@/contract";
import { HttpError } from "../http/errors";
import { createLogger } from "../log";
import { buildLockStub } from "../platform/adapters";
import type { Repo } from "../store/repo";

/**
 * One build per workspace at a time: two interleaved builds wrote over each other's items. The lock is
 * best effort (exact inside one process, eventually consistent on KV) and expires on its own, so a build
 * whose isolate was killed cannot block the workspace forever. 20 minutes covers a full live run.
 */
export const BUILD_LOCK_TTL_SECONDS = 20 * 60;

const log = createLogger("agent:lock");

export interface BuildLock {
  name: string;
  token: string;
  /** Where the lock lives: the workspace's BuildLockDO (exact across isolates) or the repo (best effort). Absent means the repo. */
  backend?: "do";
}

/**
 * Takes the workspace's build lock or throws 409 `build_running`. On Workers the BUILD_LOCK Durable Object
 * holds it; with no binding, or if the object is unreachable, the repo lock does.
 */
export async function acquireBuildLock(repo: Repo, workspaceId: string): Promise<BuildLock> {
  const name = `build:${workspaceId}`;
  const stub = buildLockStub(workspaceId);
  let token: string | null | undefined;
  let backend: BuildLock["backend"];
  if (stub) {
    try {
      token = await stub.acquire(BUILD_LOCK_TTL_SECONDS);
      backend = "do";
    } catch (e) {
      log.warn("build lock Durable Object unavailable; using the repo lock", { err: (e as Error)?.name });
    }
  }
  if (token === undefined) token = await repo.acquireLock(name, BUILD_LOCK_TTL_SECONDS);
  if (!token) throw new HttpError(409, "build_running", "A build is already running for this workspace. Wait for it to finish.");
  return backend ? { name, token, backend } : { name, token };
}

export async function releaseBuildLock(repo: Repo, lock: BuildLock): Promise<void> {
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
