import { UpstreamError } from "./errors";

/** Spend metering for Token Factory calls. Cap comes from SPEND_CAP_USD. */

export interface SpendMeter {
  record(model: string, inTokens: number, outTokens: number): void | Promise<void>;
  /** Throws UpstreamError code `spend_cap` when the cap is reached. */
  assertUnderCap(): void | Promise<void>;
  totals(): { usd: number; capUsd: number } | Promise<{ usd: number; capUsd: number }>;
}

export interface Price {
  inPerMTok: number;
  outPerMTok: number;
}

/** Estimates in USD per million tokens; replace once Token Factory list prices are confirmed. */
export const DEFAULT_PRICES: Record<string, Price> = {
  "nvidia/nemotron-3-super-120b-a12b": { inPerMTok: 0.4, outPerMTok: 1.6 },
  "nvidia/Nemotron-3.5-Super-VL": { inPerMTok: 0.4, outPerMTok: 1.6 },
  "nvidia/Nemotron-3_5-Lightning": { inPerMTok: 0.1, outPerMTok: 0.4 },
  "Qwen/Qwen3-Embedding-8B": { inPerMTok: 0.01, outPerMTok: 0 },
  "Qwen/Qwen3-Reranker-8B": { inPerMTok: 0.01, outPerMTok: 0 },
};
const FALLBACK_PRICE: Price = { inPerMTok: 1, outPerMTok: 3 };

export class InMemorySpendMeter implements SpendMeter {
  private usd = 0;

  constructor(
    private readonly capUsd: number,
    private readonly prices: Record<string, Price> = DEFAULT_PRICES,
  ) {}

  record(model: string, inTokens: number, outTokens: number): void {
    const p = this.prices[model] ?? FALLBACK_PRICE;
    this.usd += (Math.max(0, inTokens) * p.inPerMTok + Math.max(0, outTokens) * p.outPerMTok) / 1_000_000;
  }

  assertUnderCap(): void {
    if (this.usd >= this.capUsd) {
      throw new UpstreamError("spend_cap", "tokenfactory", "Spend cap reached; model calls are paused.");
    }
  }

  totals() {
    return { usd: Number(this.usd.toFixed(6)), capUsd: this.capUsd };
  }
}

let shared: SpendMeter | undefined;

/** Process-wide meter. Tests inject their own via `setSpendMeter`. */
export function getSpendMeter(capUsd: number): SpendMeter {
  shared ??= new InMemorySpendMeter(capUsd);
  return shared;
}
export function hasSpendMeter(): boolean {
  return shared !== undefined;
}
export function setSpendMeter(meter: SpendMeter | undefined): void {
  shared = meter;
}
