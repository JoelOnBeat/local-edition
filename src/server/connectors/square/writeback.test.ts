import { describe, expect, it } from "vitest";
import type { SpecialItem } from "@/contract";
import type { CatalogObjectT } from "./schemas";
import { connectSandbox } from "./connect";
import { publishApprovedSpecials, publishSpecial, idempotencyKey } from "./writeback";
import { harness, type Harness } from "./test-utils";

const EDITION = "ed_williamsburg_2026-10-26";

async function ready(): Promise<{ h: Harness; special: SpecialItem }> {
  const h = await harness();
  await connectSandbox(h.deps, h.workspaceId);
  const edition = (await h.repo.getEdition(EDITION))!;
  const special = edition.items.find((i): i is SpecialItem => i.kind === "special")!;
  await h.repo.updateEditionItem(EDITION, { ...special, status: "approved" }, special.version);
  return { h, special: ((await h.repo.getEdition(EDITION))!.items.find((i) => i.id === special.id) as SpecialItem) };
}
const upserts = (h: Harness) => h.fake.calls.filter((c) => c.method === "POST" && c.path === "/v2/catalog/object");

describe("publishing an approved special to Square", () => {
  it("creates one limited item with one variation at the store's location and records a delivery and a sync event", async () => {
    const { h, special } = await ready();
    const [delivery] = await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    expect(delivery).toMatchObject({ provider: "square", editionId: EDITION, itemId: special.id, status: "sent" });
    expect(delivery.url).toMatch(/^https:\/\/squareupsandbox\.com\/dashboard\/items\/library\/SQ\d+$/);

    const call = upserts(h)[0];
    const obj = (call.body as { object: CatalogObjectT }).object;
    expect(obj.present_at_all_locations).toBe(false);
    expect(obj.present_at_location_ids).toEqual(["LOC_1"]); // Williamsburg
    expect(obj.item_data!.name).toBe(special.name);
    expect(obj.item_data!.variations).toHaveLength(1);
    const v = obj.item_data!.variations![0];
    expect(v.item_variation_data).toMatchObject({ pricing_type: "FIXED_PRICING", sku: `LE-${special.id}` });
    const base = (await h.repo.listMenu("chain_kettle_kiln")).find((m) => m.id === special.baseMenuItemId)!;
    expect(v.item_variation_data!.price_money).toEqual({ amount: Math.round(base.price! * 100), currency: "USD" });
    expect((call.body as { idempotency_key: string }).idempotency_key).toBe(idempotencyKey(special.id, special.version));
    expect(call.headers["square-version"]).toBe("2026-09-16");
    expect((await h.ledger.listEvents(h.workspaceId, "square", 50)).some((e) => e.kind === "special.published" && e.ok && e.editionId === EDITION)).toBe(true);
    expect(await h.ledger.listDeliveries(h.workspaceId, EDITION)).toHaveLength(1);
  });

  it("is idempotent: publishing the same version again sends nothing and creates no second item", async () => {
    const { h } = await ready();
    await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    expect(upserts(h)).toHaveLength(1);
    expect([...h.fake.catalog.values()].filter((o) => o.item_data?.variations?.[0]?.item_variation_data?.sku?.startsWith("LE-"))).toHaveLength(1);
  });

  it("an edited special (new version) updates the same Square item instead of adding another", async () => {
    const { h, special } = await ready();
    const [first] = await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    const edition = (await h.repo.getEdition(EDITION))!;
    await h.repo.updateEditionItem(EDITION, { ...special, name: "Cardamom bun, orange zest", status: "approved" }, special.version);
    const [second] = await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    void edition;
    expect(second.externalId).toBe(first.externalId);
    expect(upserts(h)).toHaveLength(2);
    const sent = (upserts(h)[1].body as { object: CatalogObjectT; idempotency_key: string });
    expect(sent.object.id).toBe(first.externalId);
    expect(sent.object.version).toBe(1);
    expect(sent.idempotency_key).toBe(idempotencyKey(special.id, special.version + 1));
    expect(h.fake.catalog.get(first.externalId!)!.item_data!.name).toBe("Cardamom bun, orange zest");
    expect(h.fake.catalog.get(first.externalId!)!.item_data!.variations).toHaveLength(1);
  });

  it("the menu import never takes a published special for a base menu item", async () => {
    const { h } = await ready();
    await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    const { importFromSquare } = await import("./sync");
    await importFromSquare(h.deps, h.workspaceId, { reason: "webhook" });
    const menu = await h.repo.listMenu("chain_kettle_kiln");
    expect(menu).toHaveLength(22);
    expect(menu.some((m) => m.id.startsWith("sq_"))).toBe(false);
  });

  it("a Square failure becomes a failed delivery and a failed sync event, and never throws", async () => {
    const { h } = await ready();
    h.fake.failNext.set("/v2/catalog/object", 400);
    const [delivery] = await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    expect(delivery.status).toBe("failed");
    expect(delivery.note).toMatch(/approve it again/i);
    expect((await h.ledger.listEvents(h.workspaceId, "square", 50)).some((e) => e.kind === "special.failed" && !e.ok)).toBe(true);
    // retry succeeds and replaces the failed delivery
    const [retry] = await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    expect(retry.status).toBe("sent");
  });

  it("skips, with a reason, a store with no Square location or a base item with no price", async () => {
    const { h, special } = await ready();
    await h.ledger.replaceLocationLinks(h.workspaceId, []);
    const edition = (await h.repo.getEdition(EDITION))!;
    const noLink = await publishSpecial(h.deps, h.workspaceId, edition, special);
    expect(noLink).toMatchObject({ status: "skipped", note: expect.stringMatching(/not linked/) });

    const h2 = await ready();
    const menu = await h2.h.repo.listMenu("chain_kettle_kiln");
    await h2.h.repo.replaceMenu("chain_kettle_kiln", menu.map((m) => (m.id === h2.special.baseMenuItemId ? { ...m, price: null } : m)));
    const noPrice = await publishSpecial(h2.h.deps, h2.h.workspaceId, (await h2.h.repo.getEdition(EDITION))!, h2.special);
    expect(noPrice).toMatchObject({ status: "skipped", note: expect.stringMatching(/no price/) });
    expect(upserts(h2.h)).toHaveLength(0);
  });

  it("does nothing when Square is not connected", async () => {
    const h = await harness();
    expect(await publishApprovedSpecials(h.deps, h.workspaceId, EDITION)).toEqual([]);
    expect(h.fake.calls).toHaveLength(0);
  });

  it("re-creates the item when it was deleted in Square", async () => {
    const { h } = await ready();
    const [first] = await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    h.fake.catalog.delete(first.externalId!);
    const { special } = { special: (await h.repo.getEdition(EDITION))!.items.find((i) => i.kind === "special") as SpecialItem };
    await h.repo.updateEditionItem(EDITION, { ...special, description: "Rolled with cardamom sugar, orange zest on top.", status: "approved" }, special.version);
    const [again] = await publishApprovedSpecials(h.deps, h.workspaceId, EDITION);
    expect(again.status).toBe("sent");
    expect(again.externalId).not.toBe(first.externalId);
  });
});
