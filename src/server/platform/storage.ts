/** The slice of Durable Object storage the cores use (`ctx.storage` satisfies it; tests pass a Map-backed fake). */
export interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}
