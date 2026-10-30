import { UpstreamError } from "./errors";

/**
 * A model that vanishes from Token Factory (Nemotron 3.5 Super VL did, for a few hours on 30 Oct 2026: 404 / model_not_found)
 * must skip its step, never fail the run, and never trigger a copy or model-id rewrite. This file is the one detector and the one
 * place the plain notes live; the Token Factory client throws `ModelUnavailableError`, every role catches it with `isModelUnavailable`.
 */

export const MODEL_UNAVAILABLE = "model_unavailable" as const;
/** An error event for a step that was skipped inside a store that still builds (the lane stays as it was). */
export const STEP_SKIPPED = "step_skipped" as const;

/** How the model was found to be gone. */
export type UnavailableWhy = "http_404" | "model_not_found" | "not_listed";

/** Plain names for the notes. Keyed by exact Token Factory id (a test keeps this in step with `MODELS`). */
export const MODEL_LABELS: Readonly<Record<string, string>> = {
  "nvidia/Nemotron-3.5-Super-VL": "Nemotron 3.5 Super VL",
  "nvidia/Nemotron-3-Ultra-550b-a55b": "Nemotron 3 Ultra",
  "nvidia/Nemotron-3_5-Lightning": "Nemotron 3.5 Lightning",
  "Qwen/Qwen3-Embedding-8B": "Qwen3 Embedding 8B",
  "Qwen/Qwen3-Reranker-8B": "Qwen3 Reranker 8B",
};

export const modelLabel = (model: string | undefined): string => (model ? MODEL_LABELS[model] ?? model : "A model");

export class ModelUnavailableError extends UpstreamError {
  readonly model: string;
  readonly why: UnavailableWhy;

  constructor(model: string, why: UnavailableWhy) {
    super(MODEL_UNAVAILABLE, "tokenfactory", `${modelLabel(model)} is unavailable on Token Factory right now. Try again in a few minutes.`, { status: 404, retryable: false });
    this.name = "ModelUnavailableError";
    this.model = model;
    this.why = why;
  }
}

/**
 * True for a Token Factory answer that means "this model is not served right now": our own `ModelUnavailableError`, a 404, or a
 * body naming `model_not_found`. Auth, rate limits, 5xx and the spend cap are not this: they keep their own handling.
 */
export function isModelUnavailable(e: unknown): boolean {
  if (e instanceof ModelUnavailableError) return true;
  if (!(e instanceof UpstreamError)) return false;
  // Only Token Factory's 404 is a model going away; a 404 from Qloo or Tavily is theirs to explain.
  return e.code === MODEL_UNAVAILABLE || (e.provider === "tokenfactory" && (e.status === 404 || e.hint === "model_not_found"));
}

/** The same failure, tagged with the model the caller was using (a 404 from a fake or a lower layer carries no model). */
export function asModelUnavailable(e: unknown, model: string): ModelUnavailableError | null {
  if (e instanceof ModelUnavailableError) return e;
  if (!isModelUnavailable(e)) return null;
  const hint = (e as UpstreamError).hint;
  return new ModelUnavailableError(model, hint === "model_not_found" ? "model_not_found" : "http_404");
}

/** The model an unavailable error names, or `fallback` when it names none. */
export const unavailableModel = (e: unknown, fallback: string): string => (e instanceof ModelUnavailableError ? e.model : fallback);

// ---- The notes (run events, the run view, /proof) ------------------------------------------------------------------------------

/** A store whose agent model is gone: the store is skipped and builds on the next run. */
export const agentSkipNote = (model: string): string => `${modelLabel(model)} is unavailable on Token Factory right now; this store will build on the next run.`;
/** The reviewer: the edition still drafts, unreviewed. */
export const reviewSkipNote = (model: string): string => `Review skipped: ${modelLabel(model)} unavailable.`;
/** The copy model: the plain template stands in for the item's text. */
export const copySkipNote = (model: string): string => `${modelLabel(model)} is unavailable on Token Factory right now; this copy uses the plain template.`;
/** A tool step (matching, ranking) that needs a model which is gone. */
export const toolSkipNote = (model: string, what: string): string => `${what} skipped: ${modelLabel(model)} is unavailable on Token Factory right now.`;
/** A menu photo that cannot be read until the vision model is back. */
export const visionRetryNote = (model: string): string => `${modelLabel(model)} is unavailable on Token Factory right now, so the menu photo cannot be read. Try again in a few minutes, or import the menu from Square.`;
/** The reply classifier: the keyword rules stand in. */
export const classifySkipNote = (model: string): string => `${modelLabel(model)} is unavailable; this reply was sorted by keywords.`;
