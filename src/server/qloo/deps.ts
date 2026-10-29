import type { Repo } from "../store/repo";
import { getQlooClient, type QlooClient } from "./client";

/** Everything a Qloo function needs, injectable for tests and for the repository-backed cache. */
export interface QlooCache {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export interface QlooDeps {
  client: QlooClient;
  cache: QlooCache;
  now: () => Date;
}

export function memoryCache(now: () => number = Date.now): QlooCache & { clear(): void } {
  const map = new Map<string, { value: unknown; expires: number }>();
  return {
    async get<T>(key: string) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.expires <= now()) {
        map.delete(key);
        return null;
      }
      return hit.value as T;
    },
    async put<T>(key: string, value: T, ttlSeconds: number) {
      map.set(key, { value, expires: now() + ttlSeconds * 1000 });
    },
    clear: () => map.clear(),
  };
}

export function repoCache(repo: Pick<Repo, "cacheGet" | "cachePut">): QlooCache {
  return {
    get: <T>(key: string) => repo.cacheGet<T>(key),
    put: <T>(key: string, value: T, ttl: number) => repo.cachePut<T>(key, value, ttl),
  };
}

const processCache = memoryCache();

export function resolveDeps(partial: Partial<QlooDeps> = {}): QlooDeps {
  return {
    client: partial.client ?? getQlooClient(),
    cache: partial.cache ?? processCache,
    now: partial.now ?? (() => new Date()),
  };
}

export const TTL = { baseline: 24 * 3600, search: 24 * 3600, profile: 6 * 3600, compare: 6 * 3600 } as const;
