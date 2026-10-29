import type { KvNamespaceLike } from "../store/kv";
import type { D1Like, DurableObjectNamespaceLike, R2BucketLike, WorkflowBindingLike } from "./types";
import type { BuildLockStub, SpendMeterStub, TavilyBudgetStub } from "./stubs";
import type { BuildWorkflowInput } from "../workflows/types";

/** Everything the Worker is bound to (see wrangler.jsonc). Every binding is optional: local dev has none. */
export interface PlatformEnv {
  LE_DB?: D1Like;
  LE_KV?: KvNamespaceLike;
  LE_BLOB?: R2BucketLike;
  SPEND_METER?: DurableObjectNamespaceLike<SpendMeterStub>;
  BUILD_LOCK?: DurableObjectNamespaceLike<BuildLockStub>;
  TAVILY_BUDGET?: DurableObjectNamespaceLike<TavilyBudgetStub>;
  EDITION_BUILD?: WorkflowBindingLike<BuildWorkflowInput>;
  WEEKLY_REBUILD?: WorkflowBindingLike<BuildWorkflowInput>;
  /** Service-account JSON (`wrangler secret put NEBIUS_SA_CREDENTIALS`); absent means the weekly Nebius job is not started. */
  NEBIUS_SA_CREDENTIALS?: string;
  /** Project the job runs in; defaults to Local Edition's eu-west2 CPU project. */
  NEBIUS_PROJECT_ID?: string;
  /** https URL of the deployed app, handed to the job. */
  APP_URL?: string;
  [key: string]: unknown;
}

const slot = globalThis as typeof globalThis & { __lePlatformEnv?: PlatformEnv | null };

/**
 * Pins the bindings for code that runs outside an OpenNext request (a Workflow step, the cron, a Durable
 * Object). `env` is one constant object per deployment, so a process-wide slot is safe. Pass `null` in tests
 * to say "no platform"; `undefined` clears the pin.
 */
export function setPlatformEnv(env: PlatformEnv | null | undefined): void {
  slot.__lePlatformEnv = env;
}

/** String vars and secrets copied into `process.env`, for entrypoints that never went through OpenNext's init. */
export function applyEnvToProcess(env: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * The bindings of the current invocation, or null when there are none (`next dev`, tests, `next start`).
 * Order: the pinned env; then OpenNext's request context. `allowDevProxy` lets a deliberate local choice
 * (STORE_DRIVER=d1 under `next dev`) boot wrangler's platform proxy for D1, KV and R2; everything else leaves
 * it off, so a plain `next dev` never starts a local workerd just to find out there is nothing bound.
 */
export async function platformEnv(opts: { allowDevProxy?: boolean } = {}): Promise<PlatformEnv | null> {
  if (slot.__lePlatformEnv !== undefined) return slot.__lePlatformEnv;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    try {
      return getCloudflareContext().env as unknown as PlatformEnv;
    } catch {
      if (!opts.allowDevProxy || process.env.NODE_ENV === "production") return null;
      return (await getCloudflareContext({ async: true })).env as unknown as PlatformEnv;
    }
  } catch {
    return null;
  }
}

/**
 * Synchronous variant for bindings that need no dev proxy (Durable Objects, Workflows): the pinned env, else
 * the request context OpenNext set on the global scope. Null when neither exists.
 */
export function platformEnvSync(): PlatformEnv | null {
  if (slot.__lePlatformEnv !== undefined) return slot.__lePlatformEnv;
  const ctx = (globalThis as Record<symbol, { env?: PlatformEnv } | undefined>)[Symbol.for("__cloudflare-context__")];
  return ctx?.env ?? null;
}

export const inProduction = (): boolean => process.env.NODE_ENV === "production";
