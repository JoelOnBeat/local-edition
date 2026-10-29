/** Exact Token Factory model ids (OpenAI-compatible, base https://api.tokenfactory.nebius.com/v1/). */

export const TF_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

export const MODELS = {
  agent: "nvidia/nemotron-3-super-120b-a12b",
  vision: "nvidia/Nemotron-3.5-Super-VL",
  copy: "nvidia/Nemotron-3_5-Lightning",
  embedding: "Qwen/Qwen3-Embedding-8B",
  rerank: "Qwen/Qwen3-Reranker-8B",
} as const;

export type ModelRole = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelRole];
