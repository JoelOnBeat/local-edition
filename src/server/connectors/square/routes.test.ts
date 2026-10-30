import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCalendarIcs } from "../calendar/handlers";
import { setLedger } from "../ledger";
import { MemoryLedger } from "../ledger-memory";
import { squareWebhook } from "./handlers";
import { connectSandbox } from "./connect";
import { harness, TEST_ENV, type Harness } from "./test-utils";
import { setRepo } from "../../store";

const URL_ = "https://localedition.pages.dev/api/connectors/square/webhook";
const body = JSON.stringify({ merchant_id: "MLTESTMERCHANT", type: "catalog.version.updated", event_id: "e1", created_at: "2026-10-30T18:07:00Z", data: { type: "catalog_version", id: "x", object: { catalog_version: { updated_at: "2026-10-30T18:07:00.53Z" } } } });
const sign = async (b: string) => {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(TEST_ENV.SQUARE_WEBHOOK_SIGNATURE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(URL_ + b))).toString("base64");
};
const post = (b: string, sig?: string) => new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-square-hmacsha256-signature": sig } : {}) }, body: b });

let h: Harness;
const saved: Record<string, string | undefined> = {};
beforeEach(async () => {
  h = await harness();
  for (const [k, v] of Object.entries(TEST_ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  setRepo(h.repo);
  setLedger(h.ledger);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setLedger(undefined);
});

describe("POST /api/connectors/square/webhook", () => {
  it("401 with { error, code } for a missing or forged signature, and nothing is parsed or run", async () => {
    for (const req of [post(body), post(body, "AAAA"), post(body, await sign(body + " "))]) {
      const res = await squareWebhook(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "The webhook signature is not valid.", code: "bad_signature" });
    }
    expect(h.fake.calls).toHaveLength(0);
  });
  it("401 beats a malformed body: an unsigned stranger cannot make us parse JSON", async () => {
    const res = await squareWebhook(post("{not json"));
    expect(res.status).toBe(401);
  });
  it("200 { ok, handled } for a signed notification", async () => {
    await connectSandbox({ ...h.deps, ledger: h.ledger }, h.workspaceId);
    const res = await squareWebhook(post(body, await sign(body)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: true, eventType: "catalog.version.updated" });
  });
  it("200 handled=false for a signed event we do not use", async () => {
    const other = JSON.stringify({ merchant_id: "MLTESTMERCHANT", type: "inventory.count.updated" });
    const res = await squareWebhook(post(other, await sign(other)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false });
  });
  it("400 for a signed body that is not a JSON object", async () => {
    const res = await squareWebhook(post("[1,2]", await sign("[1,2]")));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/calendar/[token]", () => {
  const get = (token: string) => getCalendarIcs(new Request(`https://localedition.pages.dev/api/calendar/${token}`), { params: Promise.resolve({ token }) });
  it("404 { error, code } for an unknown token", async () => {
    const res = await get("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.ics");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
  });
  it("serves text/calendar for a minted token", async () => {
    const ledger = new MemoryLedger();
    setLedger(ledger);
    const token = await ledger.getOrCreateCalendarToken("demo", "chain", null, () => "tokentokentokentokentokentoken12");
    const res = await get(`${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect((await res.text()).startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });
});

describe("post-approval dispatch", () => {
  it("publishes one approved special on its own, and ignores one that is not approved", async () => {
    const { dispatchSquare, dispatchSquareItem } = await import("./dispatch");
    const { vi } = await import("vitest");
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(h.fake.fetch);
    try {
      await connectSandbox({ ...h.deps, ledger: h.ledger }, h.workspaceId);
      const edition = (await h.repo.getEdition("ed_williamsburg_2026-10-26"))!;
      const special = edition.items.find((i) => i.kind === "special")!;
      const upserts = () => h.fake.calls.filter((c) => c.path === "/v2/catalog/object" && c.method === "POST").length;
      await h.repo.updateEditionItem(edition.id, { ...special, status: "draft" }, special.version);
      await dispatchSquareItem("demo", edition.id, special.id);
      expect(upserts()).toBe(0);
      const draft = (await h.repo.getEdition(edition.id))!.items.find((i) => i.id === special.id)!;
      await h.repo.updateEditionItem(edition.id, { ...draft, status: "approved" }, draft.version);
      await dispatchSquareItem("demo", edition.id, special.id);
      await dispatchSquare({ workspaceId: "demo", editionId: edition.id }); // the edition-level pass finds it already delivered
      expect(upserts()).toBe(1);
      expect((await h.ledger.listDeliveries("demo", edition.id))[0].status).toBe("sent");
    } finally {
      spy.mockRestore();
    }
  });
});
