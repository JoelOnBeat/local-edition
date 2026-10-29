import { describe, expect, it } from "vitest";
import { MenuItem } from "@/contract";
import { createTokenFactory } from "./client";
import { MemoryRecorder } from "../http/recorder";
import { readMenuBoard, toBase64 } from "./menu";
import { categoryOf, parsePrice, scrubDescription, scrubName, toMenuItems } from "./menu-parse";
import { MODELS } from "./models";
import { chatBody, jsonRes, scriptedTf } from "./test-utils";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const vlResponse = {
  items: [
    { name: "Drip Coffee", category: "Coffee", price: 3.25, currency: "USD", description: null, confidence: 0.98 },
    { name: "drip  coffee", category: "Coffee", price: 3.5, currency: "USD", description: "Single origin", confidence: 0.9 },
    { name: "Oat Latte (V)", category: "Coffee", price: "$5.50", currency: null, description: "Vegan, gluten free. Steamed oat milk", confidence: 0.9 },
    { name: "Jasmine Pearl", category: "Tea", price: "S 4.0 / L 5.0", currency: null, description: null, confidence: 0.8 },
    { name: "Cardamom Bun", category: "Bakery", price: null, currency: null, description: "Baked each morning", confidence: 0.95 },
    { name: "Seasonal Special", category: null, price: "MKT", currency: null, description: null, confidence: 0.7 },
    { name: "Blurry smudge", category: null, price: 1, currency: null, description: null, confidence: 0.1 },
    { name: "Flat White", category: "Coffee", price: 4, currency: "EUR", description: null, confidence: 0.9 },
  ],
  unreadable_regions: ["bottom corner"],
};

describe("T2 menu parsing", () => {
  it("normalises a synthetic VL response into contract MenuItems", async () => {
    const { tf, calls } = scriptedTf(() => jsonRes(chatBody(`Here you go:\n\`\`\`json\n${JSON.stringify(vlResponse)}\n\`\`\``)));
    const items = await readMenuBoard(JPEG, "image/jpeg", tf);
    expect(() => items.forEach((i) => MenuItem.parse(i))).not.toThrow();
    expect(items.map((i) => i.name)).toEqual(["Drip Coffee", "Oat Latte", "Jasmine Pearl", "Cardamom Bun", "Seasonal Special", "Flat White"]);
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(by["Drip Coffee"]).toMatchObject({ price: 3.25, category: "coffee", description: "Single origin", source: "vl", currency: "USD" });
    expect(by["Oat Latte"]).toMatchObject({ price: 5.5, description: "Steamed oat milk" });
    expect(by["Jasmine Pearl"]).toMatchObject({ price: 4, category: "tea" });
    expect(by["Cardamom Bun"]).toMatchObject({ price: null, category: "bakery" });
    expect(by["Seasonal Special"]).toMatchObject({ price: null, category: "other" });
    expect(by["Flat White"].price).toBeNull(); // EUR is not representable in the USD-only contract
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);

    const body = calls[0].body as { model: string; messages: { role: string; content: unknown }[] };
    expect(body.model).toBe(MODELS.vision);
    const parts = body.messages[1].content as { type: string; image_url?: { url: string } }[];
    expect(parts[0]).toEqual({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(JPEG)}` } });
    expect(parts[1].type).toBe("text");
  });

  it("reads the built-in synthetic board in fixture mode (no key, no network)", async () => {
    const tf = createTokenFactory({ mode: "fixture", recorder: new MemoryRecorder() });
    const items = await readMenuBoard(JPEG, "image/jpeg", tf);
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.every((i) => MenuItem.safeParse(i).success)).toBe(true);
  });

  it("returns 422 no_menu_items when nothing legible comes back", async () => {
    const { tf } = scriptedTf(() => jsonRes(chatBody('{"items":[],"unreadable_regions":["everything"]}')));
    await expect(readMenuBoard(JPEG, "image/png", tf)).rejects.toMatchObject({ status: 422, code: "no_menu_items" });
  });

  it("repairs a truncated reply once", async () => {
    const { tf } = scriptedTf((_u, _b, n) => jsonRes(chatBody(n === 1 ? '{"items":[{"name":"Espresso","price":3' : '{"items":[{"name":"Espresso","price":3.5}]}')));
    const items = await readMenuBoard(JPEG, "image/jpeg", tf);
    expect(items).toMatchObject([{ name: "Espresso", price: 3.5 }]);
  });
});

describe("T2 menu helpers", () => {
  it("parses prices without guessing", () => {
    expect(parsePrice("$4.50")).toBe(4.5);
    expect(parsePrice("4,50")).toBe(4.5);
    expect(parsePrice(" 12 ")).toBe(12);
    expect(parsePrice("S 3.5 / L 4.5")).toBe(3.5);
    expect(parsePrice("MKT")).toBeNull();
    expect(parsePrice("£4")).toBeNull();
    expect(parsePrice(-2)).toBeNull();
    expect(parsePrice(5000)).toBeNull();
    expect(parsePrice(4.999)).toBe(5);
    expect(parsePrice(4, "usd")).toBe(4);
    expect(parsePrice(4, "GBP")).toBeNull();
  });

  it("maps headings and names to categories", () => {
    expect(categoryOf("Espresso Bar", "x")).toBe("coffee");
    expect(categoryOf("Iced Drinks", "x")).toBe("cold");
    expect(categoryOf(null, "Matcha Latte")).toBe("tea");
    expect(categoryOf("Pastries", "x")).toBe("bakery");
    expect(categoryOf("Toasts", "Avocado Toast")).toBe("food");
    expect(categoryOf("Merch", "Tote bag")).toBe("other");
  });

  it("strips health, diet and allergen wording from names and descriptions", () => {
    expect(scrubName("Granola Bowl (GF) (V)")).toBe("Granola Bowl");
    expect(scrubName("Latte (Hot)")).toBe("Latte (Hot)");
    expect(scrubDescription("Vegan. Oat milk, honey")).toBe("Oat milk, honey");
    expect(scrubDescription("Contains nuts; 320 kcal")).toBeNull();
    expect(scrubDescription("Warm and flaky")).toBe("Warm and flaky");
  });

  it("caps the list and drops tiny names", () => {
    const many = { items: Array.from({ length: 200 }, (_, i) => ({ name: `Item number ${i}` })) };
    expect(toMenuItems(many)).toHaveLength(150);
    expect(toMenuItems({ items: [{ name: "x" }] })).toEqual([]);
  });
});
