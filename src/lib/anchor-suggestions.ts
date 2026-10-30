import type { QlooEntityRef } from "@/contract";

/**
 * Brands a chain commonly resembles. Placeholder ids (`sample-…`), which a build resolves by name through Qloo's cached search.
 * Shown by the mock API, and by the real route when the Qloo call budget says no live search may run.
 */
const NAMES = [
  "Blue Bottle Coffee", "Aesop", "Muji", "Stumptown Coffee Roasters", "La Colombe", "Le Labo", "Everlane",
  "Sweetgreen", "Rapha", "Ace Hotel", "Kinfolk", "Patagonia", "Glossier", "Warby Parker", "Equinox",
];

export const brandRef = (name: string): QlooEntityRef => ({
  entityId: `sample-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name,
  type: "urn:entity:brand",
});

export const SUGGESTED_ANCHORS: QlooEntityRef[] = NAMES.map(brandRef);

/** Suggestions matching the typed text; the first few when nothing matches, so the picker is never empty. */
export function suggestAnchors(q: string, take = 8): QlooEntityRef[] {
  const term = q.trim().toLowerCase();
  const hits = SUGGESTED_ANCHORS.filter((b) => b.name.toLowerCase().includes(term));
  return (hits.length ? hits : SUGGESTED_ANCHORS).slice(0, take);
}
