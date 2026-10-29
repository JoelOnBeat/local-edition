import { clientIp, ipHash, rateLimit } from "../limits";
import { HttpError } from "../http/errors";
import type { Repo } from "../store/repo";

/** A workspace may hold this many progress streams open at once (a tab and a reconnecting tab; not a pile of pollers). */
export const MAX_TAILS_PER_WORKSPACE = 2;
/** A slot outlives the longest stream (20 minutes) by a little, so a stream that dies without closing frees it by itself. */
export const TAIL_SLOT_TTL_SECONDS = 21 * 60;

/**
 * Takes one of the workspace's tail slots (an atomic repo lock each: one conditional upsert in D1) and returns its release,
 * or throws 429 `too_many_streams`. Release is idempotent.
 */
export async function acquireTailSlot(repo: Repo, workspaceId: string): Promise<() => Promise<void>> {
  for (let slot = 0; slot < MAX_TAILS_PER_WORKSPACE; slot++) {
    const name = `tail:${workspaceId}:${slot}`;
    const token = await repo.acquireLock(name, TAIL_SLOT_TTL_SECONDS);
    if (!token) continue;
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await repo.releaseLock(name, token).catch(() => undefined);
    };
  }
  throw new HttpError(429, "too_many_streams", "This workspace already has two progress streams open. Close one and try again.");
}

/** Bucket sizes of a build, so reattaching with Last-Event-ID in a loop is no cheaper than starting builds. */
const ATTACH = { workspace: { capacity: 4, refillPerMinute: 1 }, ip: { capacity: 12, refillPerMinute: 3 } } as const;

/** Rate limit for the `Last-Event-ID` reattach path (429 `rate_limited`). It spends no model credits, so it has its own buckets. */
export async function limitAttach(ctx: { workspace: { id: string }; request: Request }): Promise<void> {
  const ip = await ipHash(clientIp(ctx.request));
  await rateLimit({ key: `attach:ws:${ctx.workspace.id}`, ...ATTACH.workspace });
  await rateLimit({ key: `attach:ip:${ip}`, ...ATTACH.ip });
}
