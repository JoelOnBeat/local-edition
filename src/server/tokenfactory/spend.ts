import { serverEnv } from "@/lib/env";
import {
  currentSpendMeter,
  priceOf,
  PricedSpendMeter,
  ResilientSpendStore,
  setSpendMeter,
  type LedgerState,
  type Price,
  type SpendStore,
  type SpendTicket,
} from "../http/spend";
import { createLogger } from "../log";
import { HttpError, UpstreamError } from "../http/errors";
import { spendMeterStub } from "../platform/adapters";
import { getRepo } from "../store";
import { MODELS } from "./models";

const log = createLogger("spend");

export type { SpendTicket } from "../http/spend";

/**
 * List prices in USD per million tokens (Token Factory public catalog, 29 Oct 2026). Built from entries so two
 * roles that share a model id (agent and vision are both Super-VL) cannot collide as object keys.
 */
export const TF_PRICES: Record<string, Price> = Object.fromEntries<Price>([
  [MODELS.agent, { inPerMTok: 0.3, outPerMTok: 0.9 }],
  [MODELS.vision, { inPerMTok: 0.3, outPerMTok: 0.9 }],
  // Ultra is the dearest model and its price is not confirmed: priced high so the cap errs on the safe side.
  [MODELS.reviewer, { inPerMTok: 0.8, outPerMTok: 2.4 }],
  [MODELS.copy, { inPerMTok: 0.06, outPerMTok: 0.24 }],
  [MODELS.embedding, { inPerMTok: 0.01, outPerMTok: 0 }],
  // Rerank pricing is unpublished; priced like embeddings until confirmed.
  [MODELS.rerank, { inPerMTok: 0.01, outPerMTok: 0 }],
]);

export function priceUsd(model: string, inTokens: number, outTokens: number, prices: Record<string, Price> = TF_PRICES): number {
  return priceOf(prices, model, inTokens, outTokens);
}

const LEDGER_KEY = "spend:ledger";
const LEDGER_TTL_SECONDS = 35 * 24 * 3600;

/** The shared ledger: one row in the repo cache (KV on Workers), so every isolate reads the same total. */
class RepoSpendStore implements SpendStore {
  async load(): Promise<LedgerState> {
    const row = await (await getRepo()).cacheGet<LedgerState>(LEDGER_KEY);
    return row && typeof row.usd === "number" && row.open ? row : { usd: 0, open: {} };
  }
  async save(state: LedgerState): Promise<void> {
    await (await getRepo()).cachePut(LEDGER_KEY, state, LEDGER_TTL_SECONDS);
  }
}

/**
 * Token Factory spend meter. `new TokenFactorySpendMeter(cap)` keeps an in-process ledger (tests);
 * `tokenFactoryMeter()` is the shared, repo-backed one that enforces SPEND_CAP_USD across isolates.
 */
export class TokenFactorySpendMeter extends PricedSpendMeter {
  constructor(capUsd: number | (() => number), prices: Record<string, Price> = TF_PRICES, store?: SpendStore) {
    super(capUsd, prices, store);
  }
}

const DO_PREFIX = "do:";

/**
 * The shared meter on Workers: when the SPEND_METER Durable Object is bound, reserve and settle go to it, so
 * the cap holds exactly across every isolate. If the object errors, a spending call is REFUSED (503
 * `spend_unavailable`): falling back to the repo ledger would be a second ledger that starts near zero, so the
 * cap would reset for the length of the outage. Without the binding (dev, tests) it is the repo-backed meter
 * above. A ticket remembers which side issued it.
 */
class DurableSpendMeter extends TokenFactorySpendMeter {
  override async reserveUsd(estimateUsd: number): Promise<SpendTicket> {
    const stub = spendMeterStub();
    if (!stub) return super.reserveUsd(estimateUsd);
    let res;
    try {
      res = await stub.reserve(estimateUsd, this.cap());
    } catch (e) {
      log.warn("spend meter Durable Object unavailable; refusing the call", { err: (e as Error)?.name });
      throw new HttpError(503, "spend_unavailable", "The model spend meter is unavailable, so no model call was made. Try again in a moment.");
    }
    if (!res.ok) throw new UpstreamError("spend_cap", "tokenfactory", "Spend cap reached; model calls are paused.");
    return { ...res.ticket, id: DO_PREFIX + res.ticket.id };
  }

  override async settleUsd(ticket: SpendTicket, actualUsd: number): Promise<void> {
    const stub = ticket.id.startsWith(DO_PREFIX) ? spendMeterStub() : null;
    if (!stub) return super.settleUsd(ticket, actualUsd);
    await stub.settle(ticket.id.slice(DO_PREFIX.length), actualUsd).catch((e) => log.warn("spend settle failed", { err: (e as Error)?.name }));
  }

  override record(model: string, inTokens: number, outTokens: number): void | Promise<void> {
    const stub = spendMeterStub();
    if (!stub) return super.record(model, inTokens, outTokens);
    return stub.record(priceOf(TF_PRICES, model, inTokens, outTokens)).catch(() => super.record(model, inTokens, outTokens));
  }

  override async totals(): Promise<{ usd: number; capUsd: number }> {
    const stub = spendMeterStub();
    if (stub) {
      try {
        const t = await stub.totals(this.cap());
        return { usd: Number(t.usd.toFixed(6)), capUsd: t.capUsd };
      } catch {
        // fall through to the repo ledger
      }
    }
    return super.totals();
  }
}

/** Process-wide meter, also registered as the shared http meter so /api/status reads the same totals. */
export function tokenFactoryMeter(): TokenFactorySpendMeter {
  const current = currentSpendMeter();
  if (current instanceof TokenFactorySpendMeter) return current;
  const meter = new DurableSpendMeter(() => serverEnv().SPEND_CAP_USD, TF_PRICES, new ResilientSpendStore(new RepoSpendStore()));
  setSpendMeter(meter);
  return meter;
}

/**
 * Reserve `estimateUsd` against the shared cap before a paid call. Throws UpstreamError `spend_cap`
 * when the cap would be exceeded. Always pass the ticket to `settleSpend`, including when the call fails.
 */
export function reserveSpend(estimateUsd: number): Promise<SpendTicket> {
  return tokenFactoryMeter().reserveUsd(estimateUsd);
}

/** Settle a reservation at the real cost. A failed or timed-out call settles at `ticket.estimateUsd`. */
export function settleSpend(ticket: SpendTicket, actualUsd: number): Promise<void> {
  return tokenFactoryMeter().settleUsd(ticket, actualUsd);
}

/** Tests only. */
export function resetTokenFactoryMeter(): void {
  setSpendMeter(undefined);
}
