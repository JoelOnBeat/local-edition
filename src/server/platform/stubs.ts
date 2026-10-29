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
  /** `token` (optional) is the caller's own: the same token asking again extends its lock instead of being refused. */
  acquire(ttlSeconds: number, token?: string): Promise<string | null>;
  release(token: string): Promise<void>;
}

export type TavilyReserveResult =
  | { ok: true; day: string; total: number; today: number }
  | { ok: false; reason: "total" | "daily"; total: number; today: number };

export interface TavilyUsage {
  total: number;
  today: number;
  day: string;
}

/** RPC surface of the TavilyBudgetDO (the one global Tavily credit ledger). */
export interface TavilyBudgetStub {
  reserve(credits: number, totalCap: number, dailyCap: number): Promise<TavilyReserveResult>;
  refund(credits: number, day: string): Promise<void>;
  usage(): Promise<TavilyUsage>;
}
