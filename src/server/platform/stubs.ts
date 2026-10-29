import type { SpendTicket } from "../http/spend";

/** RPC surface of the SpendMeterDO (the one shared ledger behind SPEND_CAP_USD). */
export interface SpendMeterStub {
  reserve(estimateUsd: number, capUsd: number): Promise<{ ok: true; ticket: SpendTicket } | { ok: false }>;
  settle(ticketId: string, actualUsd: number): Promise<void>;
  record(usd: number): Promise<void>;
  totals(capUsd: number): Promise<{ usd: number; capUsd: number }>;
}

/** RPC surface of the BuildLockDO (one per workspace). */
export interface BuildLockStub {
  acquire(ttlSeconds: number): Promise<string | null>;
  release(token: string): Promise<void>;
}
