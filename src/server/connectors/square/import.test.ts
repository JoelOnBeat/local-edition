import { describe, expect, it } from "vitest";
import { SAMPLE_CHAIN, SAMPLE_MENU, SAMPLE_STORES } from "@/server/sample/chain";
import { catalogToMenu, describeDiff, diffMenu, mapCategory, planLocations } from "./import";
import { sampleCatalog } from "./test-utils";
import type { CatalogObjectT } from "./schemas";
import { MenuItem } from "@/contract";

describe("catalogToMenu", () => {
  it("turns the sample catalog into the same menu: ids kept, source square, categories mapped", () => {
    const menu = catalogToMenu(sampleCatalog(), SAMPLE_MENU);
    expect(menu).toHaveLength(SAMPLE_MENU.length);
    for (const m of menu) MenuItem.parse(m);
    expect(menu.map((m) => m.id)).toEqual(SAMPLE_MENU.map((m) => m.id));
    expect(menu.every((m) => m.source === "square")).toBe(true);
    expect(menu.map((m) => [m.name, m.price, m.category])).toEqual(SAMPLE_MENU.map((m) => [m.name, m.price, m.category]));
  });
  it("gives new items a stable id from the variation and splits sizes into separate items", () => {
    const latte: CatalogObjectT = {
      type: "ITEM", id: "ITEM_L", item_data: { name: "House Latte", variations: [
        { type: "ITEM_VARIATION", id: "V_S", item_variation_data: { name: "Small", pricing_type: "FIXED_PRICING", price_money: { amount: 450, currency: "USD" } } },
        { type: "ITEM_VARIATION", id: "V_L", item_variation_data: { name: "Large", pricing_type: "FIXED_PRICING", price_money: { amount: 575, currency: "USD" } } },
      ] },
    };
    const menu = catalogToMenu([latte], []);
    expect(menu.map((m) => [m.id, m.name, m.price])).toEqual([["sq_V_S", "House Latte (Small)", 4.5], ["sq_V_L", "House Latte (Large)", 5.75]]);
  });
  it("skips deleted, archived, non-regular and Local Edition specials; variable prices become null", () => {
    const v = (sku?: string, pricing = "FIXED_PRICING"): CatalogObjectT => ({ type: "ITEM_VARIATION", id: `V${Math.random()}`, item_variation_data: { sku, pricing_type: pricing, price_money: { amount: 100, currency: "USD" } } });
    const items: CatalogObjectT[] = [
      { type: "ITEM", id: "A", is_deleted: true, item_data: { name: "Deleted", variations: [v()] } },
      { type: "ITEM", id: "B", item_data: { name: "Archived", is_archived: true, variations: [v()] } },
      { type: "ITEM", id: "C", item_data: { name: "Gift card", product_type: "GIFT_CARD", variations: [v()] } },
      { type: "ITEM", id: "D", item_data: { name: "Cardamom Bun special", variations: [v("LE-item_42")] } },
      { type: "ITEM", id: "E", item_data: { name: "Open coffee", variations: [v(undefined, "VARIABLE_PRICING")] } },
    ];
    const menu = catalogToMenu(items, []);
    expect(menu.map((m) => [m.name, m.price])).toEqual([["Open coffee", null]]);
  });
  it("does not use a non-USD price", () => {
    const item: CatalogObjectT = { type: "ITEM", id: "X", item_data: { name: "Tea", variations: [{ type: "ITEM_VARIATION", id: "VX", item_variation_data: { pricing_type: "FIXED_PRICING", price_money: { amount: 400, currency: "CAD" } } }] } };
    expect(catalogToMenu([item], [])[0].price).toBeNull();
  });
  it("maps categories from the Square category name, then the item name", () => {
    expect(mapCategory("Cold drinks", "Latte")).toBe("cold");
    expect(mapCategory(null, "Masala Chai")).toBe("tea");
    expect(mapCategory("Pastries", "Thing")).toBe("bakery");
    expect(mapCategory("Misc", "Gift bag")).toBe("other");
  });
});

describe("diffMenu / describeDiff", () => {
  const before = SAMPLE_MENU.slice(0, 4);
  it("reports price changes, removals and additions in plain words", () => {
    const after = [{ ...before[0], price: 3.75 }, before[1], before[3], { ...before[2], id: "sq_new", name: "Oat Cortado" }];
    const diff = diffMenu(before, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.removed.map((m) => m.id)).toEqual([before[2].id]);
    expect(diff.added.map((m) => m.id)).toEqual(["sq_new"]);
    expect(describeDiff(diff)).toBe("Espresso is now $3.75 (was $3.50); Flat White is gone; and 1 more");
  });
  it("is empty when nothing changed", () => {
    const d = diffMenu(before, structuredClone(before));
    expect([d.added.length, d.removed.length, d.changed.length]).toEqual([0, 0, 0]);
  });
});

describe("planLocations", () => {
  const locs = (names: string[]) => names.map((n, i) => ({ id: `L${i}`, name: n, address: { address_line_1: "1 Main St", locality: "Queens" } }));
  it("links a location to the store whose name it contains and creates stores for the rest", () => {
    let n = 0;
    const plan = planLocations(locs(["Kettle & Kiln Williamsburg", "Kettle & Kiln Long Island City", "Kettle & Kiln Hoboken"]), SAMPLE_STORES, SAMPLE_CHAIN, () => `store_new${n++}`);
    expect(plan.links.map((l) => l.storeId)).toEqual(["store_williamsburg", "store_long-island-city", "store_new0"]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({ name: "Kettle & Kiln Hoboken", addressLabel: "1 Main St, Queens", chainId: SAMPLE_CHAIN.id });
  });
  it("never links two locations to one store", () => {
    const plan = planLocations(locs(["Harlem", "Harlem (pop-up)"]), SAMPLE_STORES, SAMPLE_CHAIN, () => "store_extra");
    expect(plan.links.map((l) => l.storeId)).toEqual(["store_harlem", "store_extra"]);
  });
});
