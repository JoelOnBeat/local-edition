import { z } from "zod";
import type { MenuCategory, MenuItem } from "@/contract";
import { newId } from "@/lib/ids";

/** Lenient shape of what the vision model returns; normalised into contract MenuItems below. */
export const VlMenu = z.object({
  items: z
    .array(
      z.object({
        name: z.string(),
        category: z.string().nullish(),
        price: z.union([z.number(), z.string()]).nullish(),
        currency: z.string().nullish(),
        description: z.string().nullish(),
        confidence: z.number().nullish(),
      }),
    )
    .max(300),
  unreadable_regions: z.array(z.string()).nullish(),
});
export type VlMenu = z.infer<typeof VlMenu>;

export const MAX_ITEMS = 150;
const MIN_CONFIDENCE = 0.3;

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Health, diet, nutrition and allergen wording never reaches the app (contract guarantee). */
export const CLAIM_WORDS =
  /\b(vegan|vegetarian|plant[- ]based|gluten|dairy[- ]free|lactose|sugar[- ]free|keto|paleo|allergen|allergy|nuts?|calories?|kcal|nutrition\w*|low[- ]?(fat|carb|cal\w*)|healthy|organic|halal|kosher|protein|diet\w*|immun\w*)\b/i;
const TAG_PAREN = /\s*\((?:v|vg|vgn|gf|df|nf|ve|veg|vegan|vegetarian|gluten[- ]?free|dairy[- ]?free|contains[^)]*)\)\s*/gi;

export function scrubName(name: string): string {
  return name.replace(TAG_PAREN, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function scrubDescription(text: string | null | undefined): string | null {
  if (!text) return null;
  const kept = text
    .replace(TAG_PAREN, " ")
    .split(/(?<=[.;])\s+|,\s+/)
    .filter((c) => c.trim() !== "" && !CLAIM_WORDS.test(c));
  const out = kept.join(", ").replace(/\s+/g, " ").replace(/[.,;\s]+$/, "").trim().slice(0, 240);
  return out === "" ? null : out;
}

const CATEGORY_RULES: [MenuCategory, RegExp][] = [
  ["cold", /\b(cold|iced|ice|frapp\w*|smoothie|juice|soda|lemonade|shake|sparkling|refresher)\b/],
  ["tea", /\b(tea|matcha|chai|hojicha|oolong|herbal|tisane|kombucha)\b/],
  ["coffee", /\b(coffee|espresso|latte|cappuccino|cortado|macchiato|americano|flat white|mocha|drip|brew|pour over|cafe|affogato)\b/],
  ["bakery", /\b(bak\w*|pastr\w*|bread|croissant|cookie|cake|muffin|scone|bun|danish|donut|doughnut|brownie|loaf|biscuit|tart)\b/],
  ["food", /\b(food|sandwich|toast|breakfast|lunch|salad|bowl|soup|egg|eggs|wrap|bagel|panini|savou?ry|plate|snack)\b/],
];

export function categoryOf(heading: string | null | undefined, name: string): MenuCategory {
  for (const text of [norm(heading ?? ""), norm(name)]) {
    for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  }
  return "other";
}

/** Price from a number or messy text: "$4.50", "4,50", "S 3.5 / L 4.5" (lowest), "MKT" (null). Never guesses. */
export function parsePrice(value: number | string | null | undefined, currency?: string | null): number | null {
  if (currency && /^[A-Za-z]{3}$/.test(currency) && currency.toUpperCase() !== "USD") return null; // contract is USD only
  if (value === null || value === undefined) return null;
  let n: number | null = null;
  if (typeof value === "number") n = value;
  else {
    if (/[€£¥₹]/.test(value)) return null;
    const nums = [...value.replace(/(\d),(\d{2})(?!\d)/g, "$1.$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    if (nums.length) n = Math.min(...nums);
  }
  if (n === null || !Number.isFinite(n) || n < 0 || n >= 1000) return null;
  return Math.round(n * 100) / 100;
}

/** Normalise, scrub, dedupe by name and cap. Returns contract MenuItems with source `vl`. */
export function toMenuItems(menu: VlMenu): MenuItem[] {
  const byName = new Map<string, MenuItem>();
  for (const raw of menu.items) {
    if ((raw.confidence ?? 1) < MIN_CONFIDENCE) continue;
    const name = scrubName(raw.name);
    if (name.length < 2) continue;
    const key = norm(name);
    if (!key) continue;
    const price = parsePrice(raw.price, raw.currency);
    const description = scrubDescription(raw.description);
    const existing = byName.get(key);
    if (existing) {
      existing.price ??= price;
      existing.description ??= description;
      continue;
    }
    byName.set(key, {
      id: newId("mi"),
      name,
      category: categoryOf(raw.category, name),
      price,
      currency: "USD",
      description,
      source: "vl",
    });
  }
  return [...byName.values()].slice(0, MAX_ITEMS);
}

/** What the verify pass returns: one row per extracted item, judged against the same photo. */
export const VerifyOut = z.object({
  rows: z
    .array(z.object({ i: z.number().int().nonnegative(), seen: z.boolean(), price_legible: z.boolean() }))
    .max(300),
});
export type VerifyOut = z.infer<typeof VerifyOut>;

/**
 * Applies the verify pass: rows the model could not see on the photo are dropped (they were invented or
 * misread); rows whose price it could not read stay, flagged `priceLegible: false` so the UI shows them amber.
 * A row the verifier skipped is kept but flagged amber too: unconfirmed is not the same as fine.
 */
export function applyVerify(items: MenuItem[], verify: VerifyOut): { items: MenuItem[]; dropped: number } {
  const byIndex = new Map(verify.rows.map((r) => [r.i, r]));
  const kept: MenuItem[] = [];
  items.forEach((item, i) => {
    const row = byIndex.get(i);
    if (row && !row.seen) return;
    kept.push(row ? { ...item, seen: true, priceLegible: row.price_legible } : { ...item, priceLegible: false });
  });
  return { items: kept, dropped: items.length - kept.length };
}
