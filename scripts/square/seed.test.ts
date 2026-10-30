import { describe, expect, it } from "vitest";
import { catalogToMenu } from "@/server/connectors/square/import";
import { SquareClient } from "@/server/connectors/square/client";
import { fakeSquare } from "@/server/connectors/square/test-utils";
import { SAMPLE_MENU } from "@/server/sample/chain";
import { seedSandbox } from "./seed";

const run = async (fake: ReturnType<typeof fakeSquare>, dry = false) => {
  const lines: string[] = [];
  const client = new SquareClient({ accessToken: "t", env: "sandbox", mode: "live", fetchImpl: fake.fetch });
  const result = await seedSandbox(client, { dry, say: (l) => lines.push(l) });
  return { result, lines };
};

describe("scripts/square-seed", () => {
  it("seeds 20 items and 8 locations, then does nothing the second time", async () => {
    const fake = fakeSquare([], false);
    const first = await run(fake);
    expect(first.result).toEqual({ locations: 8, created: 20, updated: 0 });
    expect(fake.locations).toHaveLength(8);
    const writesAfterFirst = fake.calls.filter((c) => c.method === "POST" && c.path !== "/v2/catalog/search").length;
    const second = await run(fake);
    expect(second.result).toEqual({ locations: 0, created: 0, updated: 0 });
    expect(fake.calls.filter((c) => c.method === "POST" && c.path !== "/v2/catalog/search")).toHaveLength(writesAfterFirst);
    expect(fake.locations).toHaveLength(8);
  });
  it("what it seeds imports back as the sample menu (minus the two left off)", async () => {
    const fake = fakeSquare([], false);
    await run(fake);
    const menu = catalogToMenu([...fake.catalog.values()], SAMPLE_MENU);
    expect(menu).toHaveLength(20);
    expect(menu.find((m) => m.name === "Cardamom Morning Bun")).toMatchObject({ id: "menu_morning-bun", price: 5, category: "bakery" });
    expect(menu.map((m) => m.category).sort().filter((c, i, a) => a.indexOf(c) === i)).toEqual(["bakery", "coffee", "cold", "food", "tea"]);
  });
  it("repairs a drifted price and leaves the rest", async () => {
    const fake = fakeSquare([], false);
    await run(fake);
    const latte = [...fake.catalog.values()].find((o) => o.item_data?.name === "Latte")!;
    latte.item_data!.variations![0].item_variation_data!.price_money!.amount = 999;
    expect((await run(fake)).result).toEqual({ locations: 0, created: 0, updated: 1 });
    expect(fake.catalog.get(latte.id)!.item_data!.variations![0].item_variation_data!.price_money!.amount).toBe(550);
  });
  it("a dry run writes nothing", async () => {
    const fake = fakeSquare([], false);
    await run(fake, true);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path !== "/v2/catalog/search")).toHaveLength(0);
  });
});
