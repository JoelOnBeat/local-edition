import type { Edition, ProofResponse, ProofReview, Store } from "@/contract";
import { MODELS } from "../tokenfactory/models";

/** Which model runs which step: read from the server's model table, so the proof page can never disagree with what is deployed. */
export const PROOF_STEPS: ProofResponse["steps"] = [
  { step: "Edition agent", model: MODELS.agent, does: "Plans each store's edition and calls the Qloo, Tavily and menu tools." },
  { step: "Menu photo read", model: MODELS.vision, does: "Reads items and prices from a menu-board photo, then checks its own reading." },
  { step: "Copy", model: MODELS.copy, does: "Writes the special, the sound brief, the event and the staff card in the chain's voice." },
  { step: "Live guardrail check", model: MODELS.copy, does: "NeMo's self-check prompt on every line, inside the Worker, before anything is a draft." },
  { step: "Chain review", model: MODELS.reviewer, does: "Reads every store's edition together and flags clashes between stores." },
  { step: "Matching and ranking", model: MODELS.embedding, does: "Matches the block's flavours to menu items and ranks partner places." },
  { step: "Certification", model: "NeMo Guardrails library", does: "Runs in a Nebius Serverless Job over every item and card, started from the CLI." },
];

/** The models the given editions name as having run (agent, copy, reviewer). */
export function seenModels(editions: Edition[]): string[] {
  return [...new Set(editions.flatMap((e) => [e.generatedBy.agentModel, e.generatedBy.copyModel, ...(e.review ? [e.review.reviewedBy] : [])]))];
}

export function reviewsOf(editions: Edition[], stores: Store[]): ProofReview[] {
  const byId = new Map(stores.map((s) => [s.id, s]));
  return editions.flatMap((e): ProofReview[] => {
    const store = byId.get(e.storeId);
    return e.review && store
      ? [{ storeId: store.id, storeName: store.name, colorIndex: store.colorIndex, verdict: e.review.verdict, reason: e.review.reason, hint: e.review.hint, reviewedBy: e.review.reviewedBy }]
      : [];
  });
}
