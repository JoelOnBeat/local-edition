import { SAMPLE_MENU, SAMPLE_STORES } from "@/server/sample/chain";
import type { SquareClient } from "@/server/connectors/square/client";
import type { CatalogObjectT } from "@/server/connectors/square/schemas";

/** The sample stores' streets (sample chain, not a real customer), as Square wants them: street, borough, state, ZIP. */
const ADDRESSES: Record<string, { line: string; locality: string; zip: string }> = {
  williamsburg: { line: "175 Bedford Ave", locality: "Brooklyn", zip: "11211" },
  "park-slope": { line: "250 7th Ave", locality: "Brooklyn", zip: "11215" },
  astoria: { line: "31-01 30th Ave", locality: "Astoria", zip: "11102" },
  harlem: { line: "2294 Frederick Douglass Blvd", locality: "New York", zip: "10027" },
  "west-village": { line: "342 Bleecker St", locality: "New York", zip: "10014" },
  "lower-east-side": { line: "134 Orchard St", locality: "New York", zip: "10002" },
  "upper-east-side": { line: "1174 Lexington Ave", locality: "New York", zip: "10075" },
  "long-island-city": { line: "48-01 Vernon Blvd", locality: "Long Island City", zip: "11101" },
};
/** 20 of the sample menu's 22 items (the mocha and the yogurt cup stay off the Square menu). */
const SKIP = new Set(["menu_mocha", "menu_granola"]);
const CATEGORY_NAMES: Record<string, string> = { coffee: "Coffee", cold: "Cold drinks", tea: "Tea", bakery: "Bakery", food: "Food" };


export interface SeedResult { locations: number; created: number; updated: number }

/** Idempotent: finds what exists by name, creates or updates only what differs. */
export async function seedSandbox(client: SquareClient, opts: { dry: boolean; say: (line: string) => void }): Promise<SeedResult> {
  const { dry: DRY, say } = opts;
  const merchant = await client.merchant();
  say(`Square sandbox merchant ${merchant.businessName ?? "(unnamed)"} (${merchant.id})${DRY ? " [dry run]" : ""}`);

  // Locations
  const existingLocs = await client.listLocations();
  let madeLocs = 0;
  for (const store of SAMPLE_STORES) {
    const name = `Kettle & Kiln ${store.name}`;
    if (existingLocs.some((l) => l.name === name)) continue;
    const a = ADDRESSES[store.id.replace(/^store_/, "")];
    say(`+ location ${name}, ${a.line}, ${a.locality} NY ${a.zip}`);
    if (!DRY) {
      await client.createLocation(
        { name, business_name: "Kettle & Kiln (sample chain)", type: "PHYSICAL", description: `Sample chain store at ${store.addressLabel}`, address: { address_line_1: a.line, locality: a.locality, administrative_district_level_1: "NY", postal_code: a.zip, country: "US" } },
      );
    }
    madeLocs++;
  }

  // Categories
  const catalog = await client.fetchCatalog();
  const categoryId = new Map<string, string>();
  for (const [key, name] of Object.entries(CATEGORY_NAMES)) {
    const found = catalog.find((o) => o.type === "CATEGORY" && o.category_data?.name === name);
    if (found) { categoryId.set(key, found.id); continue; }
    say(`+ category ${name}`);
    if (DRY) { categoryId.set(key, `#cat-${key}`); continue; }
    const { object } = await client.upsertObject(`le-seed-cat-${key}`, { type: "CATEGORY", id: `#cat-${key}`, present_at_all_locations: true, category_data: { name } });
    categoryId.set(key, object.id);
  }

  // Items
  let made = 0;
  let updated = 0;
  for (const m of SAMPLE_MENU.filter((x) => !SKIP.has(x.id))) {
    const cents = Math.round((m.price ?? 0) * 100);
    const existing = catalog.find((o) => o.type === "ITEM" && o.item_data?.name === m.name && !o.is_deleted);
    const variation = existing?.item_data?.variations?.[0];
    const same = existing && variation?.item_variation_data?.price_money?.amount === cents && existing.item_data?.description === m.description;
    if (same) continue;
    const itemId = existing?.id ?? `#item-${m.id}`;
    const object: CatalogObjectT = {
      type: "ITEM", id: itemId, ...(existing?.version !== undefined ? { version: existing.version } : {}), present_at_all_locations: true,
      item_data: {
        name: m.name, description: m.description ?? undefined, product_type: "REGULAR", categories: [{ id: categoryId.get(m.category)! }],
        variations: [{
          type: "ITEM_VARIATION", id: variation?.id ?? `#var-${m.id}`, ...(variation?.version !== undefined ? { version: variation.version } : {}), present_at_all_locations: true,
          item_variation_data: { item_id: itemId, name: "Regular", pricing_type: "FIXED_PRICING", price_money: { amount: cents, currency: "USD" } },
        }],
      },
    };
    say(`${existing ? "~" : "+"} item ${m.name} $${(cents / 100).toFixed(2)}`);
    if (!DRY) await client.upsertObject(`le-seed-item-${m.id}-v${existing?.version ?? 0}`, object);
    if (existing) updated++;
    else made++;
  }
  say(`Done: ${madeLocs} locations, ${made} items created, ${updated} updated.`);
  return { locations: madeLocs, created: made, updated };
}
