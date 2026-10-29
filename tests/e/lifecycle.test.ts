import { beforeEach, describe, expect, it } from "vitest";
import type { Edition, EditionItem } from "@/contract";
import { getEdition, getPublicCard, listEditions, patchItem } from "@/server/handlers/editions";
import { getWorkspace } from "@/server/handlers/workspace";
import { DEMO_WORKSPACE_ID, createVisitorWorkspace, ensureDemoWorkspace } from "@/server/session";
import { DRAFTING_MAX_AGE_MS } from "@/server/store/reaper";
import type { Repo } from "@/server/store";
import { cardFor, cleanEdition, cookieOf, fakePorts, freshApp, json, req } from "./helpers";

/** Edition lifecycle fixes from the data-path review: M2 reaper, M3 seeding, M4 If-Match, M7 override, M9 public card. */

let repo: Repo;
let cookie: string;
let edition: Edition;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function setup() {
  repo = freshApp({}, fakePorts());
  const ws = await getWorkspace(req("/api/workspace", { ip: "10.3.3.3" }));
  cookie = cookieOf(ws);
  const body = await ws.json();
  edition = { ...cleanEdition(), id: "ed_mine", storeId: body.stores[0].id };
  await repo.putEdition(edition);
}
beforeEach(setup);

const stored = async () => (await repo.getEdition(edition.id))!;
const special = () => edition.items.find((i) => i.kind === "special")!;
async function patch(itemId: string, body: unknown, headers: Record<string, string> = {}) {
  const version = (await stored()).items.find((i) => i.id === itemId)!.version;
  return patchItem(req("/x", { cookie, ...json(body, { method: "PATCH", headers: { "if-match": String(version), ...headers } }) }), params({ id: edition.id, itemId }));
}
const withGuardrail = (item: EditionItem, status: EditionItem["guardrail"]["status"]) =>
  repo.updateEditionItem(edition.id, { ...item, guardrail: { status, reasons: status === "passed" ? [] : ["Guardrails could not be reached."] } }, item.version);

describe("M2 stale drafting editions are flagged on read", () => {
  const drafting = (createdAt: string) => repo.updateEdition(edition.id, (cur) => ({ ...cur, status: "drafting", createdAt }));

  it("flags a drafting edition older than five minutes when it is fetched, and stores that", async () => {
    await drafting(ago(DRAFTING_MAX_AGE_MS + 60_000));
    const res = await getEdition(req("/x", { cookie }), params({ id: edition.id }));
    expect((await res.json()).status).toBe("flagged");
    expect((await stored()).status).toBe("flagged");
  });

  it("flags it in the portfolio list and the workspace bundle too", async () => {
    await drafting(ago(DRAFTING_MAX_AGE_MS + 60_000));
    const list = (await (await listEditions(req("/x", { cookie }))).json()) as Edition[];
    expect(list.find((e) => e.id === edition.id)?.status).toBe("flagged");
    await drafting(ago(DRAFTING_MAX_AGE_MS + 60_000));
    const bundle = await (await getWorkspace(req("/x", { cookie }))).json();
    expect(bundle.latestEditions.find((e: Edition) => e.id === edition.id)?.status).toBe("flagged");
  });

  it("leaves a build that is still inside its window alone", async () => {
    await drafting(ago(DRAFTING_MAX_AGE_MS - 60_000));
    const res = await getEdition(req("/x", { cookie }), params({ id: edition.id }));
    expect((await res.json()).status).toBe("drafting");
  });

  it("lets a flagged-by-reaper edition be edited again instead of 409 edition_drafting forever", async () => {
    await drafting(ago(DRAFTING_MAX_AGE_MS + 60_000));
    expect((await patch(special().id, { action: "approve" })).status).toBe(200);
  });
});

describe("M3 a new workspace never inherits an unfinished edition", () => {
  const demoEdition = (over: Partial<Edition>): Edition => ({ ...cleanEdition("store_williamsburg", "ed_demo_x"), ...over });

  it("copies the newest finished week when the newest one is still drafting", async () => {
    const r = freshApp();
    await ensureDemoWorkspace(r);
    await r.putEdition(demoEdition({ id: "ed_demo_w44", weekOf: "2026-10-26", status: "draft" }));
    await r.putEdition(demoEdition({ id: "ed_demo_w45", weekOf: "2026-11-02", status: "drafting", items: [], createdAt: new Date().toISOString() }));
    const ws = await createVisitorWorkspace(r);
    const mine = await r.listEditions({ storeIds: (await r.listStores(ws.chainId)).map((s) => s.id) });
    expect(mine).toHaveLength(1);
    expect(mine[0].id.startsWith("ed_demo_w44~")).toBe(true);
    expect(mine[0].status).toBe("draft");
  });

  it("copies nothing for a store whose only edition is drafting", async () => {
    const r = freshApp();
    await ensureDemoWorkspace(r);
    await r.putEdition(demoEdition({ status: "drafting", items: [], createdAt: new Date().toISOString() }));
    const ws = await createVisitorWorkspace(r);
    expect(await r.listEditions({ storeIds: (await r.listStores(ws.chainId)).map((s) => s.id) })).toEqual([]);
    expect(DEMO_WORKSPACE_ID).toBe("demo");
  });
});

describe("M4 If-Match is required to approve, reject or edit", () => {
  const raw = (headers: Record<string, string>) =>
    patchItem(req("/x", { cookie, ...json({ action: "approve" }, { method: "PATCH", headers }) }), params({ id: edition.id, itemId: special().id }));

  it("answers 428 version_required without it, and changes nothing", async () => {
    const res = await raw({});
    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({ code: "version_required" });
    expect((await stored()).items.find((i) => i.id === special().id)!.status).toBe("draft");
  });

  it("answers 400 for a version that is not a number", async () => {
    for (const bad of ["abc", "-1", "1.5"]) {
      const res = await raw({ "if-match": bad });
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid_version" });
    }
  });

  it("answers 409 version_conflict for a stale tab, even when the action would be a no-op, and 200 for a fresh one", async () => {
    await patch(special().id, { action: "approve" }); // version 1
    const stale = await raw({ "if-match": "0" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "version_conflict" });
    expect((await raw({ "if-match": '"1"' })).status).toBe(200);
    expect((await raw({ "if-match": 'W/"1"' })).status).toBe(200);
  });

  it("checks the edition's owner before the version, so a stranger sees 404", async () => {
    const res = await patchItem(req("/x", { ip: "10.4.4.4", ...json({ action: "approve" }, { method: "PATCH" }) }), params({ id: edition.id, itemId: special().id }));
    expect(res.status).toBe(404);
  });
});

describe("M7 approving unchecked copy needs an explicit override", () => {
  it("refuses with guardrail_unchecked, then approves with override: true", async () => {
    await withGuardrail(special(), "unchecked");
    const refused = await patch(special().id, { action: "approve" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "guardrail_unchecked" });
    expect((await patch(special().id, { action: "approve", override: false })).status).toBe(409);
    const ok = await patch(special().id, { action: "approve", override: true });
    // The record stays honest: approved by a person, guardrails never passed it.
    expect(await ok.json()).toMatchObject({ status: "approved", guardrail: { status: "unchecked" } });
  });

  it("never approves flagged or blocked copy, override or not", async () => {
    await repo.updateEditionItem(edition.id, { ...special(), status: "flagged", guardrail: { status: "blocked", reasons: ["health claim"] } }, 0);
    const res = await patch(special().id, { action: "approve", override: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "guardrail_blocked" });
  });

  it("does not need an override for copy that passed or was rewritten", async () => {
    const [a, b] = edition.items;
    await withGuardrail(b, "rewritten");
    expect((await patch(a.id, { action: "approve" })).status).toBe(200);
    expect((await patch(b.id, { action: "approve" })).status).toBe(200);
  });
});

describe("M9 the public staff card is served only when it is safe", () => {
  const token = "tok_public_card_000001";
  const get = () => getPublicCard(req("/api/card/x"), params({ token }));
  const approved = () => repo.setEditionStatus(edition.id, "approved");

  it("404s while the edition is a draft, serves it once approved", async () => {
    await repo.putStaffCard(cardFor(edition, token));
    expect((await get()).status).toBe(404);
    await approved();
    expect((await get()).status).toBe(200);
  });

  it("serves passed and rewritten cards and 404s unchecked and blocked ones", async () => {
    await approved();
    for (const [status, code] of [["passed", 200], ["rewritten", 200], ["unchecked", 404], ["blocked", 404]] as const) {
      await repo.putStaffCard({ ...cardFor(edition, token), guardrail: { status, reasons: [] } });
      expect((await get()).status, status).toBe(code);
    }
  });

  it("does not serve a card whose lines were blanked because the edition changed", async () => {
    await approved();
    await repo.putStaffCard({ ...cardFor(edition, token), lines: [] });
    expect((await get()).status).toBe(404);
  });

  it("stops serving the old card the moment head office edits or rejects an item", async () => {
    await repo.putStaffCard(cardFor(edition, token));
    await approved();
    expect((await get()).status).toBe(200);
    await patch(special().id, { action: "edit", patch: { name: "Cardamom Morning Bun" } });
    expect((await get()).status).toBe(404);
    expect((await repo.getStaffCardByToken(token))?.lines).toEqual([]); // the share link itself survives
  });
});
