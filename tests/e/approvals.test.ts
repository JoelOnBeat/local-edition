import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Edition, EditionItem, StaffCard } from "@/contract";
import { approveAll, getEdition, getPublicCard, patchItem } from "@/server/handlers/editions";
import { getWorkspace } from "@/server/handlers/workspace";
import { deriveEditionStatus } from "@/server/handlers/items";
import type { CheckCopy } from "@/server/jobs/ports";
import type { Repo } from "@/server/store";
import { cardFor, cleanEdition, cookieOf, fakePorts, freshApp, json, req } from "./helpers";

let repo: Repo;
let cookie: string;
let edition: Edition;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function setup(check?: CheckCopy) {
  repo = freshApp({}, fakePorts(check ? { checkCopy: check } : {}));
  const ws = await getWorkspace(req("/api/workspace", { ip: "10.2.2.2" }));
  cookie = cookieOf(ws);
  const body = await ws.json();
  edition = { ...cleanEdition(), id: "ed_mine", storeId: body.stores[0].id };
  await repo.putEdition(edition);
}
const patch = (itemId: string, body: unknown, headers: Record<string, string> = {}) =>
  patchItem(req("/x", { cookie, ...json(body, { method: "PATCH", headers }) }), params({ id: edition.id, itemId }));
const stored = async () => (await repo.getEdition(edition.id))!;
const special = () => edition.items.find((i) => i.kind === "special")!;

beforeEach(async () => { await setup(); });

describe("T2 approve and reject", () => {
  it("approves an item, bumps its version and is idempotent", async () => {
    const res = await patch(special().id, { action: "approve" });
    expect(await res.json()).toMatchObject({ status: "approved", version: 1 });
    const again = await patch(special().id, { action: "approve" });
    expect(await again.json()).toMatchObject({ status: "approved", version: 1 });
    expect((await stored()).status).toBe("draft");
  });

  it("marks the edition approved once every live item is approved, and a rejected item no longer blocks it", async () => {
    const [a, b, c, d] = edition.items;
    for (const i of [a, b, c]) await patch(i.id, { action: "approve" });
    expect((await stored()).status).toBe("draft");
    await patch(d.id, { action: "reject" });
    expect((await stored()).status).toBe("approved");
    await patch(d.id, { action: "approve" });
    expect((await stored()).items.find((i) => i.id === d.id)!.status).toBe("approved");
  });

  it("refuses to approve copy that guardrails blocked", async () => {
    const flagged: EditionItem = { ...special(), status: "flagged", guardrail: { status: "blocked", rail: "health claims", reasons: ["health claim: boosts immunity"] } };
    await repo.updateEditionItem(edition.id, flagged, 0);
    const res = await patch(special().id, { action: "approve" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "guardrail_blocked" });
    expect((await stored()).items.find((i) => i.id === special().id)!.status).toBe("flagged");
  });

  it("rejects an edition that is still drafting, and unknown items", async () => {
    expect((await patch("item_nope", { action: "approve" })).status).toBe(404);
    await repo.setEditionStatus(edition.id, "drafting");
    const res = await patch(special().id, { action: "approve" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "edition_drafting" });
  });
});

describe("T2 optimistic versions", () => {
  it("returns 409 version_conflict when If-Match is stale, and applies nothing", async () => {
    await patch(special().id, { action: "reject" }); // now version 1
    const res = await patch(special().id, { action: "approve" }, { "if-match": "0" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "version_conflict" });
    expect((await stored()).items.find((i) => i.id === special().id)!.status).toBe("rejected");
    const fresh = await patch(special().id, { action: "approve" }, { "if-match": '"1"' });
    expect(fresh.status).toBe(200);
  });

  it("lets only one of two simultaneous edits win when both carry the same version", async () => {
    const results = await Promise.all([
      patch(special().id, { action: "edit", patch: { name: "Cardamom Morning Bun" } }, { "if-match": "0" }),
      patch(special().id, { action: "edit", patch: { name: "Brown Butter Cookie" } }, { "if-match": "0" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe("T2 edit re-runs guardrails", () => {
  it("passes clean copy through as `edited` and sends every text field to guardrails with the brand voice", async () => {
    const check = vi.fn<CheckCopy>(async () => ({ status: "passed", reasons: [] }));
    await setup(check);
    const res = await patch(special().id, { action: "edit", patch: { description: "Cardamom sugar rolled by hand each morning." } });
    expect(await res.json()).toMatchObject({ status: "edited", description: "Cardamom sugar rolled by hand each morning.", guardrail: { status: "passed" }, version: 1 });
    expect(check).toHaveBeenCalledTimes(4); // name, description, staffLine, flavourTags
    expect(check.mock.calls[0][0]).toMatchObject({ kind: "special", brandVoice: expect.arrayContaining([expect.any(String)]) });
    expect(check.mock.calls.map((c) => c[0].text)).toContain("Cardamom sugar rolled by hand each morning.");
  });

  it("flags the item when guardrails block the edit, and the edition turns flagged", async () => {
    await setup(async ({ text }) => /immunity/i.test(text) ? { status: "blocked", rail: "health claims", reasons: ["health claim: immunity"] } : { status: "passed", reasons: [] });
    const res = await patch(special().id, { action: "edit", patch: { description: "Boosts your immunity all winter." } });
    const item = await res.json();
    expect(res.status).toBe(200);
    expect(item).toMatchObject({ status: "flagged", guardrail: { status: "blocked", rail: "health claims", reasons: ["health claim: immunity"] } });
    expect((await stored()).status).toBe("flagged");
    // and it cannot be approved until edited clean
    expect((await patch(special().id, { action: "approve" })).status).toBe(409);
    const clean = await patch(special().id, { action: "edit", patch: { description: "Cardamom sugar, rolled by hand." } });
    expect(await clean.json()).toMatchObject({ status: "edited", guardrail: { status: "passed" } });
    expect((await stored()).status).toBe("draft");
  });

  it("applies a rewrite from guardrails to that field and records the original", async () => {
    await setup(async ({ text }) => text.includes("!!!") ? { status: "rewritten", rail: "brand voice", reasons: ["no exclamation marks"], text: text.replaceAll("!!!", "."), original: text } : { status: "passed", reasons: [] });
    const res = await patch(special().id, { action: "edit", patch: { staffLine: "Say it loud!!!" } });
    expect(await res.json()).toMatchObject({ status: "edited", staffLine: "Say it loud.", guardrail: { status: "rewritten", original: "Say it loud!!!" } });
  });

  it("marks the item unchecked (never passed) when guardrails are down or throw", async () => {
    await setup(async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:8000"); });
    const res = await patch(special().id, { action: "edit", patch: { name: "Cardamom Morning Bun" } });
    const item = await res.json();
    expect(item).toMatchObject({ status: "edited", guardrail: { status: "unchecked" } });
    expect(JSON.stringify(item.guardrail)).not.toContain("ECONNREFUSED");
  });

  it("rejects fields that do not belong to the item kind, and empty patches", async () => {
    const res = await patch(special().id, { action: "edit", patch: { brief: "wrong kind" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_patch" });
    expect((await patch(special().id, { action: "edit", patch: {} })).status).toBe(400);
    const event = edition.items.find((i) => i.kind === "event")!;
    expect((await patch(event.id, { action: "edit", patch: { time: "25:99" } })).status).toBe(400);
    expect((await patch(event.id, { action: "edit", patch: { day: "Funday" } })).status).toBe(400);
    expect((await patch(event.id, { action: "edit", patch: { day: "Fri", time: "19:30" } })).status).toBe(200);
  });
});

describe("T2 approve-all", () => {
  it("approves what passed, skips flagged, rejected and unchecked items, and reports the edition status", async () => {
    const [a, b, c, d] = edition.items;
    await repo.updateEditionItem(edition.id, { ...a, status: "flagged", guardrail: { status: "blocked", reasons: ["x"] } }, 0);
    await repo.updateEditionItem(edition.id, { ...b, status: "rejected" }, 0);
    await repo.updateEditionItem(edition.id, { ...c, guardrail: { status: "unchecked", reasons: ["down"] } }, 0);
    const res = await approveAll(req("/x", { cookie, method: "POST" }), params({ id: edition.id }));
    const out = (await res.json()) as Edition;
    const byId = Object.fromEntries(out.items.map((i) => [i.id, i.status]));
    expect(byId).toEqual({ [a.id]: "flagged", [b.id]: "rejected", [c.id]: "draft", [d.id]: "approved" });
    expect(out.status).toBe("flagged");
  });

  it("approves a clean edition completely, including already-edited items", async () => {
    const [a] = edition.items;
    await patch(a.id, { action: "edit", patch: { name: "Cardamom Morning Bun" } });
    const out = (await (await approveAll(req("/x", { cookie, method: "POST" }), params({ id: edition.id }))).json()) as Edition;
    expect(out.items.every((i) => i.status === "approved")).toBe(true);
    expect(out.status).toBe("approved");
    expect(out.items.every((i) => i.version >= 1)).toBe(true);
  });

  it("is refused for an edition still drafting and 404 for someone else's", async () => {
    await repo.setEditionStatus(edition.id, "drafting");
    expect((await approveAll(req("/x", { cookie, method: "POST" }), params({ id: edition.id }))).status).toBe(409);
    expect((await approveAll(req("/x", { method: "POST", ip: "10.9.9.9" }), params({ id: edition.id }))).status).toBe(404);
  });
});

describe("T2 deriveEditionStatus", () => {
  it("covers drafting, flagged, approved and the empty edition", () => {
    const item = (status: EditionItem["status"], g: EditionItem["guardrail"]["status"] = "passed") => ({ status, guardrail: { status: g, reasons: [] } }) as unknown as EditionItem;
    expect(deriveEditionStatus({ status: "drafting", items: [] })).toBe("drafting");
    expect(deriveEditionStatus({ status: "draft", items: [item("approved"), item("approved")] })).toBe("approved");
    expect(deriveEditionStatus({ status: "draft", items: [item("approved"), item("draft", "blocked")] })).toBe("flagged");
    expect(deriveEditionStatus({ status: "draft", items: [item("rejected"), item("rejected")] })).toBe("draft");
    expect(deriveEditionStatus({ status: "draft", items: [] })).toBe("draft");
  });
});

describe("T2 public staff card", () => {
  const card = (): StaffCard => cardFor(edition, "tok_public_card_000001");
  it("serves the card with its store and chain name to anyone holding the token, without a cookie", async () => {
    await repo.putStaffCard(card());
    const res = await getPublicCard(req("/api/card/x"), params({ token: "tok_public_card_000001" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = await res.json();
    expect(body.card.editionId).toBe(edition.id);
    expect(body.store.id).toBe(edition.storeId);
    expect(body.chainName).toContain("Kettle & Kiln");
  });
  it("404s for an unknown token and for a blocked card", async () => {
    expect((await getPublicCard(req("/x"), params({ token: "nope" }))).status).toBe(404);
    await repo.putStaffCard({ ...card(), guardrail: { status: "blocked", reasons: ["x"] } });
    const res = await getPublicCard(req("/x"), params({ token: "tok_public_card_000001" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
  });
  it("does not expose an edition through the owner route to a stranger", async () => {
    const res = await getEdition(req("/x", { ip: "10.8.8.8" }), params({ id: edition.id }));
    expect(res.status).toBe(404);
  });
});
