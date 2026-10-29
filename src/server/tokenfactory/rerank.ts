import { UpstreamError } from "../http/errors";
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
    if (!(e instanceof UpstreamError) || !FALLBACK_CODES.has(e.code)) throw e;
  }
  const emb = await tf.embeddings([query, ...documents]);
  const [q, ...docs] = emb.vectors;
  const results = docs
    .map((v, index) => ({ index, score: Number(cosine(q, v).toFixed(6)) }))
    .sort((a, b) => b.score - a.score);
  return { results, method: "embedding-cosine", mode: emb.mode };
}
