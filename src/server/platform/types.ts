/**
 * Structural types for the Cloudflare bindings this app uses. Declared here (instead of pulling in
 * @cloudflare/workers-types) so the Next project type-checks without workerd's global types, and so
 * tests can pass a fake or Miniflare's real binding through the same shapes.
 */

export interface D1Meta {
  changes?: number;
  last_row_id?: number;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: D1Meta;
}

export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedLike;
  batch(statements: D1PreparedLike[]): Promise<D1Result[]>;
}

export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
  size: number;
}

export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  delete(key: string | string[]): Promise<void>;
}

/** A Durable Object stub exposing the RPC methods of one of our classes. */
export interface DurableObjectNamespaceLike<Stub> {
  idFromName(name: string): unknown;
  get(id: unknown): Stub;
}

export interface WorkflowInstanceLike {
  id: string;
  status(): Promise<{ status: string; error?: string; output?: unknown }>;
}

export interface WorkflowBindingLike<Params> {
  create(opts: { id?: string; params: Params }): Promise<WorkflowInstanceLike>;
  get(id: string): Promise<WorkflowInstanceLike>;
}
