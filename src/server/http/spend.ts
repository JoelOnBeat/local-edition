import { UpstreamError } from "./errors";
import { createLogger } from "../log";

/**
 * Spend metering for paid model calls: reserve the worst-case cost BEFORE the call, settle the real
 * cost after. Failed and timed-out calls settle at the reserved estimate (the provider may still bill
 * them). The ledger lives behind a `SpendStore`: tokenfactory/spend.ts backs it with the shared repo
 * cache so every isolate sees one total. KV has no compare-and-swap, so across isolates this is best
 * effort until the Durable Object phase; the in-process mutex makes it exact inside one isolate, and a
 * hard budget on the Nebius key is the real backstop.
 */

const log = createLogger("spend");

export interface Price {
  inPerMTok: number;
  outPerMTok: number;
}

export interface SpendTicket {
  id: string;
  estimateUsd: number;
}

export interface SpendUsage {
  model: string;
  inTokens: number;
  outTokens: number;
}

export interface SpendMeter {
  /** Reserve the worst-case cost of a call about to be made. Throws UpstreamError `spend_cap`. */
  reserve(req: { body?: unknown }): Promise<SpendTicket>;
  /** Settle a ticket: at the measured usage, or at the reserved estimate when there is none (failed call). */
  settle(ticket: SpendTicket, usage?: SpendUsage): Promise<void>;
  /** Reserve and settle a known usage in one step (tests, status tooling). */
  record(model: string, inTokens: number, outTokens: number): void | Promise<void>;
  totals(): Promise<{ usd: number; capUsd: number }>;
}

// ---------- ledger state and stores ----------

export interface LedgerState {
  /** Settled spend, USD. */
  usd: number;
  /** Reservations not yet settled, by ticket id. */
  open: Record<string, { usd: number; at: number }>;
}

export interface SpendStore {
  load(): Promise<LedgerState>;
  save(state: LedgerState): Promise<void>;
}

const emptyState = (): LedgerState => ({ usd: 0, open: {} });

export class MemorySpendStore implements SpendStore {
  state: LedgerState = emptyState();
  async load() { return this.state; }
  async save(state: LedgerState) { this.state = state; }
}

/** Reads and writes the primary store; any failure there falls back to an in-process copy, never to "no limit". */
export class ResilientSpendStore implements SpendStore {
  private readonly local = new MemorySpendStore();
  constructor(private readonly primary: SpendStore) {}

  async load(): Promise<LedgerState> {
    try {
      const shared = await this.primary.load();
      // Never report less than this isolate has itself spent.
      return shared.usd >= this.local.state.usd ? shared : { usd: this.local.state.usd, open: shared.open };
    } catch (e) {
      log.warn("shared spend ledger unavailable; using the in-process total", { err: (e as Error)?.name });
      return this.local.state;
    }
  }

  async save(state: LedgerState): Promise<void> {
    this.local.state = structuredClone(state);
    try {
      await this.primary.save(state);
    } catch (e) {
      log.warn("shared spend ledger write failed", { err: (e as Error)?.name });
    }
  }
}

// ---------- the priced meter ----------

/** A reservation nobody settled (isolate killed mid-call) counts as spent after this long. */
export const ABANDONED_TICKET_MS = 10 * 60_000;
/** Used when a model has no price: priced like the dearest known one so the cap errs on the safe side. */
export const FALLBACK_PRICE: Price = { inPerMTok: 0.3, outPerMTok: 0.9 };
const DEFAULT_MAX_OUT_TOKENS = 4000;
const IMAGE_TOKENS = 1500;
const DATA_IMAGE = /data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi;

/** ~4 chars per token; each inline image counts a flat 1500 tokens. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const images = (text.match(/data:image\/[a-z+.-]+;base64,/gi) ?? []).length;
  return Math.ceil(text.replace(DATA_IMAGE, "").length / 4) + images * IMAGE_TOKENS;
}

export function priceOf(prices: Record<string, Price>, model: string, inTokens: number, outTokens: number): number {
  const p = prices[model] ?? FALLBACK_PRICE;
  return (Math.max(0, inTokens) * p.inPerMTok + Math.max(0, outTokens) * p.outPerMTok) / 1_000_000;
}

export class PricedSpendMeter implements SpendMeter {
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 0;

  constructor(
    private readonly capUsd: number | (() => number),
    protected readonly prices: Record<string, Price> = {},
    protected readonly store: SpendStore = new MemorySpendStore(),
    private readonly now: () => number = Date.now,
  ) {}

  protected cap(): number {
    return typeof this.capUsd === "function" ? this.capUsd() : this.capUsd;
  }

  /** Worst case for a request body: all input tokens plus `max_tokens` of output at the model's price. */
  estimateBodyUsd(body: unknown): number {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const model = typeof b.model === "string" ? b.model : "";
    const inTokens = estimateTokens(b.messages ?? b.input ?? b.documents ?? b);
    const maxOut = typeof b.max_tokens === "number" ? b.max_tokens : b.messages ? DEFAULT_MAX_OUT_TOKENS : 0;
    return Math.max(priceOf(this.prices, model, inTokens, maxOut), 1e-6);
  }

  /** Serialise reads-modify-writes inside this isolate. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private fold(state: LedgerState): LedgerState {
    const limit = this.now() - ABANDONED_TICKET_MS;
    for (const [id, t] of Object.entries(state.open)) {
      if (t.at < limit) {
        state.usd += t.usd;
        delete state.open[id];
      }
    }
    return state;
  }

  private static heldUsd(state: LedgerState): number {
    return Object.values(state.open).reduce((sum, t) => sum + t.usd, 0);
  }

  reserveUsd(estimateUsd: number): Promise<SpendTicket> {
    return this.exclusive(async () => {
      const state = this.fold(await this.store.load());
      if (state.usd + PricedSpendMeter.heldUsd(state) + estimateUsd > this.cap()) {
        throw new UpstreamError("spend_cap", "tokenfactory", "Spend cap reached; model calls are paused.");
      }
      const ticket: SpendTicket = { id: `${this.now().toString(36)}-${(this.seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`, estimateUsd };
      state.open[ticket.id] = { usd: estimateUsd, at: this.now() };
      await this.store.save(state);
      return ticket;
    });
  }

  settleUsd(ticket: SpendTicket, actualUsd: number): Promise<void> {
    return this.exclusive(async () => {
      const state = this.fold(await this.store.load());
      // A ticket folded as abandoned was already counted at its estimate; do not add it twice.
      if (state.open[ticket.id]) {
        delete state.open[ticket.id];
        state.usd += Math.max(0, actualUsd);
        await this.store.save(state);
      }
    });
  }

  reserve(req: { body?: unknown }): Promise<SpendTicket> {
    return this.reserveUsd(this.estimateBodyUsd(req.body));
  }

  async settle(ticket: SpendTicket, usage?: SpendUsage): Promise<void> {
    const actual = usage ? priceOf(this.prices, usage.model, usage.inTokens, usage.outTokens) : ticket.estimateUsd;
    await this.settleUsd(ticket, actual);
  }

  /** Records known usage without a prior reservation. Synchronous on the default in-process store. */
  record(model: string, inTokens: number, outTokens: number): void | Promise<void> {
    const usd = priceOf(this.prices, model, inTokens, outTokens);
    if (this.store instanceof MemorySpendStore) {
      this.store.state.usd += usd;
      return;
    }
    return this.exclusive(async () => {
      const state = this.fold(await this.store.load());
      state.usd += usd;
      await this.store.save(state);
    });
  }

  async totals(): Promise<{ usd: number; capUsd: number }> {
    const state = this.fold(await this.store.load());
    return { usd: Number((state.usd + PricedSpendMeter.heldUsd(state)).toFixed(6)), capUsd: this.cap() };
  }
}

// ---------- process-wide registry ----------

let shared: SpendMeter | undefined;

/** Process-wide meter. Tokenfactory installs the shared one; tests inject their own via `setSpendMeter`. */
export function getSpendMeter(capUsd: number): SpendMeter {
  shared ??= new PricedSpendMeter(capUsd);
  return shared;
}
export function currentSpendMeter(): SpendMeter | undefined {
  return shared;
}
export function hasSpendMeter(): boolean {
  return shared !== undefined;
}
export function setSpendMeter(meter: SpendMeter | undefined): void {
  shared = meter;
}
