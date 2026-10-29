import type { Edition, EditionItemKind } from "@/contract";

/**
 * The reviewer writes each hint as `<kind>: <instruction>` ("partner: pick a neighbour other than Tin Bell
 * Records"), so the app knows which item to regenerate. The contract's review has no kind field of its own.
 */
const HINT = /^\s*(special|sound|partner|event)\s*:\s*(\S[\s\S]*)$/i;

export function hintKind(hint: string | null | undefined): EditionItemKind | null {
  const m = hint ? HINT.exec(hint) : null;
  return m ? (m[1].toLowerCase() as EditionItemKind) : null;
}

/** The reviewer's hint for this item when the edition needs a change and the hint is about this kind (or names none). */
export function defaultHintFor(edition: Pick<Edition, "review">, kind: EditionItemKind): string | undefined {
  const review = edition.review;
  if (!review || review.verdict !== "needs_change" || !review.hint) return undefined;
  const named = hintKind(review.hint);
  return named === null || named === kind ? review.hint : undefined;
}
