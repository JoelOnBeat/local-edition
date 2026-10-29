import { PricedSpendMeter, type LedgerState, type SpendStore, type SpendTicket } from "../http/spend";
import { UpstreamError } from "../http/errors";
import type { StorageLike } from "./storage";
import type { SpendMeterStub } from "./stubs";

const KEY = "ledger";

class StorageSpendStore implements SpendStore {
  constructor(private readonly storage: StorageLike) {}
  async load(): Promise<LedgerState> {
    return (await this.storage.get<LedgerState>(KEY)) ?? { usd: 0, open: {} };
  }
  async save(state: LedgerState): Promise<void> {
    await this.storage.put(KEY, state);
  }
}

/**
 * The shared spend ledger, logic only. SpendMeterDO wraps one of these around its own storage: a Durable
 * Object runs one request at a time (and storage awaits keep its input gate closed), so reserve and settle
 * are atomic across every isolate, which Workers KV could not give. The reserve-then-settle rules are the
 * existing PricedSpendMeter's, so the DO and the in-process fallback cannot drift apart.
 */
export class SpendLedgerCore implements SpendMeterStub {
  private cap = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly meter: PricedSpendMeter;

  constructor(storage: StorageLike, now: () => number = Date.now) {
    this.meter = new PricedSpendMeter(() => this.cap, {}, new StorageSpendStore(storage), now);
  }

  /** Own queue, so `cap` cannot change between being set and the operation reading it. */
  private exclusive<T>(capUsd: number, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => { this.cap = capUsd; return fn(); });
    this.chain = run.catch(() => undefined);
    return run;
  }

  reserve(estimateUsd: number, capUsd: number): Promise<{ ok: true; ticket: SpendTicket } | { ok: false }> {
    return this.exclusive(capUsd, async () => {
      try {
        return { ok: true as const, ticket: await this.meter.reserveUsd(estimateUsd) };
      } catch (e) {
        if (e instanceof UpstreamError && e.code === "spend_cap") return { ok: false as const };
        throw e;
      }
    });
  }

  settle(ticketId: string, actualUsd: number): Promise<void> {
    return this.exclusive(0, () => this.meter.settleUsd({ id: ticketId, estimateUsd: 0 }, actualUsd));
  }

  /** Spend with no prior reservation (tests, status tooling): counted even past the cap, never refused. */
  record(usd: number): Promise<void> {
    return this.exclusive(Number.MAX_SAFE_INTEGER, async () => {
      const ticket = await this.meter.reserveUsd(0);
      await this.meter.settleUsd(ticket, Math.max(0, usd));
    });
  }

  totals(capUsd: number): Promise<{ usd: number; capUsd: number }> {
    return this.exclusive(capUsd, () => this.meter.totals());
  }
}
