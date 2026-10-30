import { UpstreamError } from "../http/errors";
import { isModelUnavailable, ModelUnavailableError } from "../http/model-unavailable";
import { MODELS } from "./models";
import type { TfMode, TokenFactory } from "./client";
import { cosine } from "./vector";

export interface RerankOutcome {
  /** Sorted by score, best first. `index` is the position in the input documents. */
  results: { index: number; score: number }[];
  /** Which scorer produced the numbers; the UI says so. */
  method: "rerank" | "embedding-cosine";
  mode: TfMode;
}

/** Errors that mean "the reranker is not usable here"; anything else (cap, auth, network) is surfaced. */
const FALLBACK_CODES = new Set(["upstream_4xx", "invalid_response", "bad_json", "upstream_5xx"]);

type Scorer = Pick<TokenFactory, "mode" | "rawRerank" | "embeddings">;

/** Try /v1/rerank; when the model is missing or the endpoint rejects it, score by embedding cosine. */
export async function rerankDocuments(tf: Scorer, query: string, documents: string[]): Promise<RerankOutcome> {
  if (documents.length === 0) return { results: [], method: "rerank", mode: tf.mode };
  try {
    const r = await tf.rawRerank(query, documents);
    return { results: r.scores, method: "rerank", mode: r.mode };
  } catch (e) {
    if (!isModelUnavailable(e) && (!(e instanceof UpstreamError) || !FALLBACK_CODES.has(e.code))) throw e;
  }
  const emb = await tf.embeddings([query, ...documents]);
  const [q, ...docs] = emb.vectors;
  const results = docs
    .map((v, index) => ({ index, score: Number(cosine(q, v).toFixed(6)) }))
    .sort((a, b) => b.score - a.score);
  return { results, method: "embedding-cosine", mode: emb.mode };
}

/**
 * Live check (29 Oct 2026): /v1/rerank answers 404 model_not_found for Qwen3-Reranker-8B. Remember a 404 for ten
 * minutes (per client) so every partner ranking does not pay a wasted round trip before the embedding fallback.
 */
export function rerankUnavailableMemo<F extends (query: string, documents: string[]) => Promise<unknown>>(raw: F, now: () => number = Date.now): F {
  let goneUntil = 0;
  return (async (query: string, documents: string[]) => {
    if (now() < goneUntil) throw new ModelUnavailableError(MODELS.rerank, "http_404");
    try {
      return await raw(query, documents);
    } catch (e) {
      if (isModelUnavailable(e)) goneUntil = now() + 10 * 60_000;
      throw e;
    }
  }) as F;
}
