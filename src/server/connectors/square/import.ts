import type { MenuCategory, MenuItem, Store } from "@/contract";
import { MAX_MENU_ITEMS } from "@/contract";
import { SPECIAL_SKU_PREFIX } from "./config";
import type { CatalogObjectT, SquareLocation } from "./schemas";

/** Square catalog -> MenuItem[] (the contract the photo read also produces, with source "square"); locations -> stores. */

const norm = (s: string): string => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

const CATEGORY_WORDS: [MenuCategory, RegExp][] = [
  ["cold", /\b(cold|iced|nitro|lemonade|soda|juice|smoothie)\b/],
  ["tea", /\b(tea|chai|matcha|hojicha)\b/],
  ["coffee", /\b(coffee|espresso|latte|cortado|brew|pour over|drip|mocha|cappuccino|americano)\b/],
  ["bakery", /\b(bakery|pastry|pastries|croissant|bread|cookie|bun|muffin|dessert|baked)\b/],
  ["food", /\b(food|sandwich|toast|breakfast|lunch|salad|bowl|snack|yogurt)\b/],
];

/** Category by the Square category's name first, then the item's own name; `other` when neither says. */
export function mapCategory(categoryName: string | null, itemName: string): MenuCategory {
  for (const text of [categoryName, itemName]) {
    if (!text) continue;
    const n = norm(text);
    for (const [cat, re] of CATEGORY_WORDS) if (re.test(n)) return cat;
  }
  return "other";
}

const plain = (s: string | null | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? (t.length > 240 ? `${t.slice(0, 237)}...` : t) : null;
};

export const isLocalEditionSpecial = (item: CatalogObjectT): boolean =>
  (item.item_data?.variations ?? []).some((v) => v.item_variation_data?.sku?.startsWith(SPECIAL_SKU_PREFIX));

/**
 * One MenuItem per priced variation. An item with several sizes becomes "Latte (Large)". Ids of an existing menu are kept
 * when the name matches (editions reference menu ids, so a re-import must not orphan them); anything new gets `sq_<variation id>`.
 */
export function catalogToMenu(objects: CatalogObjectT[], existing: MenuItem[] = []): MenuItem[] {
  const categories = new Map(objects.filter((o) => o.type === "CATEGORY" && !o.is_deleted).map((o) => [o.id, o.category_data?.name ?? ""]));
  const reusable = new Map(existing.map((m) => [norm(m.name), m.id]));
  const taken = new Set<string>();
  const out: MenuItem[] = [];

  for (const item of objects) {
    const data = item.item_data;
    if (item.type !== "ITEM" || item.is_deleted || !data?.name || data.is_archived) continue;
    if (data.product_type && data.product_type !== "REGULAR") continue;
    if (isLocalEditionSpecial(item)) continue;
    const catId = data.categories?.[0]?.id ?? data.category_id ?? data.reporting_category?.id;
    const category = mapCategory(catId ? categories.get(catId) ?? null : null, data.name);
    const variations = (data.variations ?? []).filter((v) => !v.is_deleted);
    const rows = variations.length > 0 ? variations : [null];
    for (const v of rows) {
      const vd = v?.item_variation_data;
      const label = rows.length > 1 && vd?.name && norm(vd.name) !== "regular" ? `${data.name} (${vd.name})` : data.name;
      const name = label.length > 80 ? `${label.slice(0, 77)}...` : label;
      const money = vd?.price_money;
      const price = vd?.pricing_type === "FIXED_PRICING" && money?.amount !== undefined && (money.currency ?? "USD") === "USD" ? money.amount / 100 : null;
      let id = reusable.get(norm(name));
      if (!id || taken.has(id)) id = `sq_${v?.id ?? item.id}`.slice(0, 64);
      if (taken.has(id)) continue;
      taken.add(id);
      out.push({
        id, name, category, price, currency: "USD", source: "square",
        description: plain(data.description_plaintext ?? data.description),
        priceLegible: price !== null,
      });
      if (out.length >= MAX_MENU_ITEMS) return out;
    }
  }
  return out;
}

export interface MenuDiff {
  added: MenuItem[];
  removed: MenuItem[];
  changed: { before: MenuItem; after: MenuItem }[];
}

const same = (a: MenuItem, b: MenuItem) => a.name === b.name && a.price === b.price && a.category === b.category && (a.description ?? "") === (b.description ?? "");

export function diffMenu(before: MenuItem[], after: MenuItem[]): MenuDiff {
  const b = new Map(before.map((m) => [m.id, m]));
  const a = new Map(after.map((m) => [m.id, m]));
  return {
    added: after.filter((m) => !b.has(m.id)),
    removed: before.filter((m) => !a.has(m.id)),
    changed: after.flatMap((m) => (b.has(m.id) && !same(b.get(m.id)!, m) ? [{ before: b.get(m.id)!, after: m }] : [])),
  };
}

/** "Cortado is now $5.00 (was $4.75)", "Almond Croissant is gone", ... at most two clauses. */
export function describeDiff(diff: MenuDiff): string {
  const money = (n: number | null) => (n === null ? "no price" : `$${n.toFixed(2)}`);
  const parts: string[] = [];
  for (const c of diff.changed) parts.push(c.before.price !== c.after.price ? `${c.after.name} is now ${money(c.after.price)} (was ${money(c.before.price)})` : `${c.after.name} was edited`);
  for (const r of diff.removed) parts.push(`${r.name} is gone`);
  for (const n of diff.added) parts.push(`${n.name} was added`);
  const shown = parts.slice(0, 2).join("; ");
  return parts.length > 2 ? `${shown}; and ${parts.length - 2} more` : shown;
}

export interface LocationPlan {
  /** location id -> store id (existing or a new one). */
  links: { locationId: string; name: string; storeId: string }[];
  /** New stores to create (location had no matching store). */
  create: Store[];
}

/** A location named "Kettle & Kiln Williamsburg" belongs to the store "Williamsburg": the store's name appears whole in the location's. */
export function matchStore(location: SquareLocation, stores: Store[], used: Set<string>): Store | null {
  const loc = norm(location.name ?? location.business_name ?? "");
  const candidates = stores.filter((s) => !used.has(s.id) && loc.includes(norm(s.name))).sort((a, b) => b.name.length - a.name.length);
  return candidates[0] ?? null;
}

export function planLocations(
  locations: SquareLocation[],
  stores: Store[],
  chain: { id: string; city: { lat: number; lon: number } },
  newId: () => string,
): LocationPlan {
  const used = new Set<string>();
  const links: LocationPlan["links"] = [];
  const create: Store[] = [];
  let colour = stores.length;
  for (const loc of locations) {
    const name = (loc.name ?? loc.business_name ?? loc.id).slice(0, 80);
    const hit = matchStore(loc, stores, used);
    if (hit) {
      used.add(hit.id);
      links.push({ locationId: loc.id, name, storeId: hit.id });
      continue;
    }
    const a = loc.address;
    const label = [a?.address_line_1, a?.locality].filter(Boolean).join(", ").slice(0, 160) || name;
    const store: Store = {
      id: newId(), chainId: chain.id, name, addressLabel: label,
      lat: loc.coordinates?.latitude ?? chain.city.lat, lon: loc.coordinates?.longitude ?? chain.city.lon,
      colorIndex: (colour++ % 8) + 1,
    };
    create.push(store);
    used.add(store.id);
    links.push({ locationId: loc.id, name, storeId: store.id });
  }
  return { links, create };
}
