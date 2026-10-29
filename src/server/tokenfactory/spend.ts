import { UpstreamError } from "../http/errors";
import { setSpendMeter, type Price, type SpendMeter } from "../http/spend";
import { serverEnv } from "@/lib/env";
import { MODELS } from "./models";

/** List prices in USD per million tokens (Token Factory public catalog, 29 Oct 2026). */
export const TF_PRICES: Record<string, Price> = {
  [MODELS.agent]: { inPerMTok: 0.3, outPerMTok: 0.9 },
  [MODELS.vision]: { inPerMTok: 0.3, outPerMTok: 0.9 },
  [MODELS.copy]: { inPerMTok: 0.06, outPerMTok: 0.24 },
  [MODELS.embedding]: { inPerMTok: 0.01, outPerMTok: 0 },
  // Rerank pricing is unpublished; priced like embeddings until confirmed.
  [MODELS.rerank]: { inPerMTok: 0.01, outPerMTok: 0 },
};
/** Unknown model: charge like the dearest known one so the cap errs on the safe side. */
const UNKNOWN_MODEL_PRICE: Price = { inPerMTok: 0.3, outPerMTok: 0.9 };

export function priceUsd(model: string, inTokens: number, outTokens: number, prices: Record<string, Price> = TF_PRICES): number {
  const p = prices[model] ?? UNKNOWN_MODEL_PRICE;
  return (Math.max(0, inTokens) * p.inPerMTok + Math.max(0, outTokens) * p.outPerMTok) / 1_000_000;
}

/** Counts Token Factory spend and refuses calls (code `spend_cap`) once SPEND_CAP_USD is reached. */
export class TokenFactorySpendMeter implements SpendMeter {
  private usd = 0;

  constructor(
    private readonly capUsd: number,
    private readonly prices: Record<string, Price> = TF_PRICES,
  ) {}

  record(model: string, inTokens: number, outTokens: number): void {
    this.usd += priceUsd(model, inTokens, outTokens, this.prices);
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

let installed: TokenFactorySpendMeter | undefined;

/** Process-wide meter, also registered as the shared http meter so /api/status reads the same totals. */
export function tokenFactoryMeter(): TokenFactorySpendMeter {
  if (!installed) {
    installed = new TokenFactorySpendMeter(serverEnv().SPEND_CAP_USD);
    setSpendMeter(installed);
  }
  return installed;
}

/** Tests only. */
export function resetTokenFactoryMeter(): void {
  installed = undefined;
  setSpendMeter(undefined);
}
