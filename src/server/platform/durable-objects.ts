import { DurableObject } from "cloudflare:workers";
import type { SpendTicket } from "../http/spend";
import { BuildLockCore } from "./lock-core";
import { SpendLedgerCore } from "./spend-core";
import type { BuildLockStub, SpendMeterStub } from "./stubs";

/**
 * The Durable Object classes bound in wrangler.jsonc (SpendMeterDO as SPEND_METER, one global instance;
 * BuildLockDO as BUILD_LOCK, one instance per workspace). Only worker/index.ts imports this file, because
 * `cloudflare:workers` exists nowhere else; the logic lives in the cores so tests run it without workerd.
 */
export class SpendMeterDO extends DurableObject implements SpendMeterStub {
  private readonly core = new SpendLedgerCore(this.ctx.storage);
  reserve(estimateUsd: number, capUsd: number): Promise<{ ok: true; ticket: SpendTicket } | { ok: false }> { return this.core.reserve(estimateUsd, capUsd); }
  settle(ticketId: string, actualUsd: number): Promise<void> { return this.core.settle(ticketId, actualUsd); }
  record(usd: number): Promise<void> { return this.core.record(usd); }
  totals(capUsd: number): Promise<{ usd: number; capUsd: number }> { return this.core.totals(capUsd); }
}

export class BuildLockDO extends DurableObject implements BuildLockStub {
  private readonly core = new BuildLockCore(this.ctx.storage);
  acquire(ttlSeconds: number): Promise<string | null> { return this.core.acquire(ttlSeconds); }
  release(token: string): Promise<void> { return this.core.release(token); }
}
