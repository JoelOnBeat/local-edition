import { describe, expect, it } from "vitest";
import { harness, TEST_ENV } from "./test-utils";
import { authenticateWebhook, handleSquareWebhook, verifySquareSignature } from "./webhook";
import { connectSandbox } from "./connect";

const URL_ = "https://localedition.pages.dev/api/connectors/square/webhook";
const KEY = TEST_ENV.SQUARE_WEBHOOK_SIGNATURE_KEY;

async function sign(url: string, body: string, key: string = KEY): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(url + body))).toString("base64");
}

// Shape per developer.squareup.com/reference/square/webhooks/catalog.version.updated
const body = JSON.stringify({
  merchant_id: "MLTESTMERCHANT", type: "catalog.version.updated", event_id: "aeaaa5f6-c4fd-4e93-b688-71b50706266f",
  created_at: "2026-10-30T18:07:00.808603647Z",
  data: { type: "catalog_version", id: "732b6677-1acb-4d81-b09c-5a3a49399d8f", object: { catalog_version: { updated_at: "2026-10-30T18:07:00.53Z" } } },
});

describe("verifySquareSignature", () => {
  it("accepts the right signature", async () => {
    expect(await verifySquareSignature({ rawBody: body, signature: await sign(URL_, body), signatureKey: KEY, notificationUrl: URL_ })).toBe(true);
  });
  it("rejects a tampered body", async () => {
    const sig = await sign(URL_, body);
    expect(await verifySquareSignature({ rawBody: body.replace("MLTEST", "MLOTHER"), signature: sig, signatureKey: KEY, notificationUrl: URL_ })).toBe(false);
  });
  it("rejects a signature made for a different URL", async () => {
    const sig = await sign("https://evil.example/api/connectors/square/webhook", body);
    expect(await verifySquareSignature({ rawBody: body, signature: sig, signatureKey: KEY, notificationUrl: URL_ })).toBe(false);
  });
  it("rejects the wrong key, a missing header, junk and a truncated signature", async () => {
    const good = await sign(URL_, body);
    expect(await verifySquareSignature({ rawBody: body, signature: await sign(URL_, body, "other-key"), signatureKey: KEY, notificationUrl: URL_ })).toBe(false);
    expect(await verifySquareSignature({ rawBody: body, signature: null, signatureKey: KEY, notificationUrl: URL_ })).toBe(false);
    expect(await verifySquareSignature({ rawBody: body, signature: "%%%not-base64%%%", signatureKey: KEY, notificationUrl: URL_ })).toBe(false);
    expect(await verifySquareSignature({ rawBody: body, signature: good.slice(0, 20), signatureKey: KEY, notificationUrl: URL_ })).toBe(false);
    expect(await verifySquareSignature({ rawBody: body, signature: good, signatureKey: "", notificationUrl: URL_ })).toBe(false);
  });
});

describe("authenticateWebhook", () => {
  const req = (sig: string | null) => new Request("https://some-other-host.example/api/connectors/square/webhook", { method: "POST", headers: sig ? { "x-square-hmacsha256-signature": sig } : {}, body });
  const bytes = new TextEncoder().encode(body);

  it("uses the registered URL, not the host the request arrived on", async () => {
    const { deps } = await harness();
    await expect(authenticateWebhook(deps, req(await sign(URL_, body)), bytes)).resolves.toBeUndefined();
  });
  it("401 bad_signature for a forged request, 503 when no key is configured", async () => {
    const { deps } = await harness();
    await expect(authenticateWebhook(deps, req("AAAA"), bytes)).rejects.toMatchObject({ status: 401, code: "bad_signature" });
    await expect(authenticateWebhook(deps, req(null), bytes)).rejects.toMatchObject({ status: 401 });
    const noKey = await harness({ ...TEST_ENV, SQUARE_WEBHOOK_SIGNATURE_KEY: "" });
    await expect(authenticateWebhook(noKey.deps, req(await sign(URL_, body)), bytes)).rejects.toMatchObject({ status: 503, code: "webhook_not_configured" });
  });
});

describe("handleSquareWebhook", () => {
  async function connected() {
    const h = await harness();
    await connectSandbox(h.deps, h.workspaceId);
    return h;
  }
  const run = async (h: Awaited<ReturnType<typeof connected>>, payload: unknown) => {
    const pending: Promise<unknown>[] = [];
    const ack = await handleSquareWebhook(h.deps, payload, (p) => pending.push(p));
    await Promise.all(pending);
    return ack;
  };

  it("re-imports the menu, flags the editions built on a changed item and logs it", async () => {
    const h = await connected();
    const latte = h.fake.catalog.get("ITEM_latte")!;
    latte.item_data!.variations![0].item_variation_data!.price_money!.amount = 500;
    // Williamsburg's mock special builds on a base item: make that item change in Square.
    const base = (await h.repo.getEdition("ed_williamsburg_2026-10-26"))!.items.find((i) => i.kind === "special")!;
    const slug = (base as { baseMenuItemId: string }).baseMenuItemId.replace(/^menu_/, "");
    const obj = h.fake.catalog.get(`ITEM_${slug}`)!;
    obj.item_data!.variations![0].item_variation_data!.price_money!.amount = 999;

    const ack = await run(h, JSON.parse(body));
    expect(ack).toEqual({ ok: true, handled: true, eventType: "catalog.version.updated" });

    const menu = await h.repo.listMenu((await h.repo.getChain("chain_kettle_kiln"))!.id);
    expect(menu.find((m) => m.name === "Latte")?.price).toBe(5);
    expect(menu.every((m) => m.source === "square")).toBe(true);
    const edition = (await h.repo.getEdition("ed_williamsburg_2026-10-26"))!;
    expect(edition.sourceChange?.provider).toBe("square");
    expect(edition.sourceChange?.summary).toMatch(/^Menu changed in Square at 14:07 ET:/);
    const events = await h.ledger.listEvents(h.workspaceId, "square", 20);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["webhook.received", "menu.changed", "edition.flagged"]));
    expect((await h.ledger.getConnection(h.workspaceId, "square"))!.meta.lastCatalogChangeAt).toBe("2026-10-30T18:07:00.53Z");
  });

  it("changes nothing when the catalog is the same", async () => {
    const h = await connected();
    await run(h, JSON.parse(body));
    expect((await h.repo.getEdition("ed_williamsburg_2026-10-26"))!.sourceChange ?? null).toBeNull();
  });

  it("ignores other event types, unknown merchants and malformed bodies", async () => {
    const h = await connected();
    const calls = h.fake.calls.length;
    expect(await run(h, { ...JSON.parse(body), type: "payment.updated" })).toMatchObject({ handled: false });
    expect(await run(h, { ...JSON.parse(body), merchant_id: "MLSTRANGER" })).toMatchObject({ handled: false });
    expect(await run(h, { nonsense: true })).toMatchObject({ handled: false });
    expect(h.fake.calls.length).toBe(calls);
  });

  it("logs a failed sync and keeps the menu when Square is down", async () => {
    const h = await connected();
    h.fake.failNext.set("/v2/catalog/search", 400);
    const before = await h.repo.listMenu("chain_kettle_kiln");
    await run(h, JSON.parse(body));
    expect(await h.repo.listMenu("chain_kettle_kiln")).toEqual(before);
    expect((await h.ledger.listEvents(h.workspaceId, "square", 20)).some((e) => e.kind === "sync.failed" && !e.ok)).toBe(true);
  });
});
