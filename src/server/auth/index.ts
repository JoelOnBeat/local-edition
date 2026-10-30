import { serverEnv } from "@/lib/env";
import { platformEnv } from "../platform/env";
import { MemoryKv } from "../store/memory";
import type { AuthStore } from "./store";
import { D1AuthStore } from "./store-d1";
import { KvAuthStore } from "./store-kv";

export * from "./store";

const slot = globalThis as typeof globalThis & { __leAuthStore?: AuthStore };

/**
 * The account store: D1 when the Worker is bound to `LE_DB` (production, and `next dev` with STORE_DRIVER=d1), a JSON file under `.data/`
 * for the dev `file` driver (accounts survive a restart, like the workspaces they own), otherwise memory. Production never falls back
 * silently: a missing binding there is a configuration error.
 */
export async function getAuthStore(): Promise<AuthStore> {
  if (slot.__leAuthStore) return slot.__leAuthStore;
  const driver = serverEnv().STORE_DRIVER;
  const bound = (await platformEnv({ allowDevProxy: driver === "d1" }))?.LE_DB;
  // Not cached on globalThis: the D1 binding belongs to the current invocation's env.
  if (bound) return new D1AuthStore(bound);
  if (process.env.NODE_ENV === "production") throw new Error("Accounts need the LE_DB binding.");
  const kv = driver === "file"
    ? new (await import("../store/file")).FileKv(`${process.env.LE_DATA_DIR ?? ".data"}/auth.json`)
    : new MemoryKv();
  slot.__leAuthStore = new KvAuthStore(kv);
  return slot.__leAuthStore;
}

/** Tests inject their own store; `undefined` goes back to the automatic choice. */
export function setAuthStore(store: AuthStore | undefined): void {
  slot.__leAuthStore = store;
}
