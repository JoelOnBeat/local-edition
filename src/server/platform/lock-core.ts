import { newToken } from "@/lib/ids";
import type { StorageLike } from "./storage";
import type { BuildLockStub } from "./stubs";

interface Held {
  token: string;
  expiresAt: number;
}

const KEY = "lock";

/**
 * One workspace's build lock, logic only (BuildLockDO wraps it). The Durable Object serialises callers, so
 * "free, then taken" is one atomic step; the TTL means a build whose isolate died cannot hold it forever.
 */
export class BuildLockCore implements BuildLockStub {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: StorageLike, private readonly now: () => number = Date.now) {}

  /** The object's own gates already serialise callers; this queue makes the core correct on any storage. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * `token` lets a caller name its own token: asking again with the token that holds the lock extends it (a retried
   * Workflow step takes its own lock back) instead of failing. Without one, a fresh random token is issued.
   */
  acquire(ttlSeconds: number, token?: string): Promise<string | null> {
    return this.exclusive(async () => {
      const held = await this.storage.get<Held>(KEY);
      if (held && held.expiresAt > this.now() && !(token && held.token === token)) return null;
      token = token ?? newToken();
      await this.storage.put(KEY, { token, expiresAt: this.now() + ttlSeconds * 1000 } satisfies Held);
      return token;
    });
  }

  release(token: string): Promise<void> {
    return this.exclusive(async () => {
      const held = await this.storage.get<Held>(KEY);
      if (held?.token === token) await this.storage.delete(KEY);
    });
  }
}
