/** Exact Token Factory model ids (OpenAI-compatible, base https://api.tokenfactory.nebius.com/v1/). */

export const TF_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

export const MODELS = {
  // nemotron-3-super-120b-a12b and Nemotron-3-Nano leave Token Factory Serverless on 9 Nov 2026
  // (before judging); Nebius names Super-VL as the replacement. Ultra is the reviewer.
  agent: "nvidia/Nemotron-3.5-Super-VL",
  reviewer: "nvidia/Nemotron-3-Ultra-550b-a55b",
  vision: "nvidia/Nemotron-3.5-Super-VL",
  copy: "nvidia/Nemotron-3_5-Lightning",
  embedding: "Qwen/Qwen3-Embedding-8B",
  rerank: "Qwen/Qwen3-Reranker-8B",
} as const;

export type ModelRole = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelRole];
