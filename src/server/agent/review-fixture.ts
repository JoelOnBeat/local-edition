import type { Clash, StoreEdition } from "./clash";

/**
 * Fixture mode only (`deps.seedBadItem`, the same switch as the verifier's seeded test): the sample model has no
 * judgment to give, so its structured reply echoes the schema and names none of our stores. Rather than report eight `review_missing` errors,
 * the review pass answers from the clashes code already proved, and says so in `reviewedBy`. A store with a clash gets
 * `needs_change` and a regenerate hint; every other store is approved with a reason that names what was (not) checked.
 */
export const FIXTURE_REVIEWER = "code-clash-check (fixture mode, no model)";

const HINT_FOR: Record<Clash["itemKind"], string> = {
  special: "special: pick a different menu item for this block than the other store's.",
  sound: "sound: choose different artists than the other store's brief.",
  partner: "partner: choose a different local partner near this store than the other store's.",
  event: "event: pick a different event for this store than the other store's.",
};

export interface FixtureVerdict {
  storeId: string;
  verdict: "approve" | "needs_change";
  reason: string;
  clashWith: string[];
  hint: string | null;
}

/** The first clash decides the hint; later ones are named in the reason. */
export function fixtureVerdicts(entries: StoreEdition[], clashes: Clash[]): FixtureVerdict[] {
  return entries.map(({ storeId, storeName }) => {
    const mine = clashes.filter((c) => c.a === storeId || c.b === storeId);
    if (!mine.length) {
      return { storeId, verdict: "approve", reason: `No clash with another store found by code. ${storeName}'s brand fit was not judged: this is fixture mode.`, clashWith: [], hint: null };
    }
    const others = [...new Set(mine.map((c) => (c.a === storeId ? c.b : c.a)))];
    return { storeId, verdict: "needs_change", reason: mine.map((c) => c.detail).join(" ").slice(0, 600), clashWith: others, hint: HINT_FOR[mine[0].itemKind] };
  });
}
