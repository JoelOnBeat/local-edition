import { platformEnv } from "../platform/env";
import { D1Ledger } from "./ledger-d1";
import { MemoryLedger } from "./ledger-memory";
import type { ConnectorLedger } from "./types";

export * from "./types";

const slot = globalThis as typeof globalThis & { __leConnectorLedger?: ConnectorLedger };

/**
 * The connector ledger: D1 when the Worker is bound to `LE_DB` (production, and `next dev` with STORE_DRIVER=d1), otherwise
 * memory. Production never falls back to memory silently: a missing binding there is a configuration error.
 */
export async function getLedger(): Promise<ConnectorLedger> {
  if (slot.__leConnectorLedger) return slot.__leConnectorLedger;
  const bound = (await platformEnv({ allowDevProxy: process.env.STORE_DRIVER === "d1" }))?.LE_DB;
  if (bound) {
    // Not cached on globalThis: the binding belongs to the current invocation's env.
    return new D1Ledger(bound);
  }
  if (process.env.NODE_ENV === "production") throw new Error("The connector ledger needs the LE_DB binding.");
  slot.__leConnectorLedger = new MemoryLedger();
  return slot.__leConnectorLedger;
}

export function setLedger(ledger: ConnectorLedger | undefined): void {
  slot.__leConnectorLedger = ledger;
}
