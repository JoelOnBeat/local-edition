import { beforeEach, describe, expect, it } from "vitest";
import type { Edition, WorkspaceBundle } from "@/contract";
import { MAX_STORES, createStore, deleteStore, getWorkspace, importStores, putChain, putMenu } from "@/server/handlers/workspace";
import { getEdition, listEditions, patchItem } from "@/server/handlers/editions";
import { DEMO_WORKSPACE_ID, ensureDemoWorkspace, readCookie } from "@/server/session";
import { canonicalId } from "@/server/store";
import type { Repo } from "@/server/store";
import { cardFor, cleanEdition, cookieOf, freshApp, json, req } from "./helpers";

let repo: Repo;
beforeEach(() => { repo = freshApp(); });

const bundle = async (res: Response) => (await res.json()) as WorkspaceBundle;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
async function visit(ip = "10.0.0.1") {
  const res = await getWorkspace(req("/api/workspace", { ip }));
  return { res, cookie: cookieOf(res), body: await bundle(res.clone()) };
}

describe("T2 workspace sessions", () => {
  it("seeds a private sample workspace and sets an httpOnly SameSite=Lax cookie", async () => {
    const { res, cookie, body } = await visit();
    expect(res.status).toBe(200);
    const raw = res.headers.get("set-cookie")!;
    expect(raw).toMatch(/^le_ws=ws_[0-9a-z]+;/);
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Lax");
    expect(raw).not.toContain("Secure"); // plain http in dev
    expect(body.chain.isSample).toBe(true);
    expect(body.stores).toHaveLength(8);
    expect(body.menu).toHaveLength(22);
    expect(body.workspace.id).toBe(readCookie(req("/", { cookie }), "le_ws"));
    expect(body.chain.id).not.toBe("chain_kettle_kiln");
    expect(canonicalId(body.stores[0].id)).toBe("store_williamsburg");
    expect(new Set(body.stores.map((s) => s.chainId))).toEqual(new Set([body.chain.id]));
  });

  it("marks the cookie Secure behind https", async () => {
    const res = await getWorkspace(req("/api/workspace", { headers: { "x-forwarded-proto": "https" } }));
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("reuses the workspace for a returning cookie and mints a new one for an unknown cookie", async () => {
    const first = await visit();
    const again = await getWorkspace(req("/api/workspace", { cookie: first.cookie }));
    expect(again.headers.get("set-cookie")).toBeNull();
    expect((await bundle(again)).workspace.id).toBe(first.body.workspace.id);

    const forged = await getWorkspace(req("/api/workspace", { cookie: "le_ws=ws_doesnotexist" }));
    expect(forged.headers.get("set-cookie")).toMatch(/^le_ws=ws_/);
    expect((await bundle(forged)).workspace.id).not.toBe("ws_doesnotexist");
  });

  it("never lets a cookie claim the demo workspace", async () => {
    await ensureDemoWorkspace(repo);
    const res = await getWorkspace(req("/api/workspace", { cookie: `le_ws=${DEMO_WORKSPACE_ID}` }));
    expect((await bundle(res)).workspace.id).not.toBe(DEMO_WORKSPACE_ID);
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });

  it("rate-limits new workspaces per IP but not returning visitors, and keeps other IPs free", async () => {
    for (let i = 0; i < 10; i++) expect((await visit("203.0.113.9")).res.status).toBe(200);
    const blocked = await getWorkspace(req("/api/workspace", { ip: "203.0.113.9" }));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: "rate_limited" });
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect((await visit("203.0.113.10")).res.status).toBe(200);
    const returning = await visit("198.51.100.1");
    for (let i = 0; i < 9; i++) await visit("198.51.100.1");
    expect((await getWorkspace(req("/api/workspace", { ip: "198.51.100.1", cookie: returning.cookie }))).status).toBe(200);
  });

  it("copies the demo workspace's newest editions and cards into a new workspace with fresh ids and tokens", async () => {
    await ensureDemoWorkspace(repo);
    const demoEdition = cleanEdition("store_williamsburg", "ed_demo_wb");
    await repo.putEdition(demoEdition);
    await repo.putStaffCard(cardFor(demoEdition, "tok_demo_public_000001"));

    const { body } = await visit();
    expect(body.latestEditions).toHaveLength(1);
    const copy = body.latestEditions[0] as Edition;
    expect(copy.id).not.toBe("ed_demo_wb");
    expect(canonicalId(copy.id)).toBe("ed_demo_wb");
    expect(body.stores.some((s) => s.id === copy.storeId)).toBe(true);
    const card = await repo.getStaffCardByEdition(copy.id);
    expect(card?.token).not.toBe("tok_demo_public_000001");
    expect(card?.storeId).toBe(copy.storeId);
    // The demo's own rows are untouched.
    expect((await repo.getEdition("ed_demo_wb"))?.storeId).toBe("store_williamsburg");
  });
});

describe("T2 workspace isolation", () => {
  it("keeps two visitors' chains, menus, stores and edits apart", async () => {
    const a = await visit("10.0.0.1");
    const b = await visit("10.0.0.2");
    expect(a.body.workspace.id).not.toBe(b.body.workspace.id);

    const chainRes = await putChain(req("/api/chain", { cookie: a.cookie, ...json({ name: "Ash & Alder", brandVoice: ["Quiet and exact."], anchors: a.body.chain.anchors }, { method: "PUT" }) }));
    expect((await chainRes.json()).name).toBe("Ash & Alder");
    await putMenu(req("/api/menu", { cookie: a.cookie, ...json(a.body.menu.slice(0, 3), { method: "PUT" }) }));
    const created = await (await createStore(req("/api/stores", { cookie: a.cookie, ...json({ name: "Greenpoint", addressLabel: "Manhattan Ave & Greenpoint Ave", lat: 40.7311, lon: -73.9544 }) }))).json();

    const seenByB = await bundle(await getWorkspace(req("/api/workspace", { cookie: b.cookie })));
    expect(seenByB.chain.name).toContain("Kettle & Kiln");
    expect(seenByB.menu).toHaveLength(22);
    expect(seenByB.stores).toHaveLength(8);
    expect(seenByB.stores.map((s) => s.id)).not.toContain(created.id);
    const seenByA = await bundle(await getWorkspace(req("/api/workspace", { cookie: a.cookie })));
    expect(seenByA.stores).toHaveLength(9);
    expect(seenByA.chain.isSample).toBe(false);
  });

  it("answers 404 when one visitor reaches for another's store or edition", async () => {
    const a = await visit("10.0.0.1");
    const b = await visit("10.0.0.2");
    const storeA = a.body.stores[0];
    const edition = { ...cleanEdition(), id: "ed_a_private", storeId: storeA.id };
    await repo.putEdition(edition);

    const del = await deleteStore(req(`/api/stores/${storeA.id}`, { method: "DELETE", cookie: b.cookie }), params({ id: storeA.id }));
    expect(del.status).toBe(404);
    expect(await repo.getStore(storeA.id)).not.toBeNull();

    const get = await getEdition(req(`/api/editions/${edition.id}`, { cookie: b.cookie }), params({ id: edition.id }));
    expect(get.status).toBe(404);
    const itemId = edition.items[0].id;
    const patch = await patchItem(req("/x", { cookie: b.cookie, ...json({ action: "reject" }, { method: "PATCH" }) }), params({ id: edition.id, itemId }));
    expect(patch.status).toBe(404);
    expect((await repo.getEdition(edition.id))!.items[0].status).toBe("draft");

    expect(await (await listEditions(req("/api/editions", { cookie: b.cookie }))).json()).toEqual([]);
    expect(((await (await listEditions(req("/api/editions", { cookie: a.cookie }))).json()) as Edition[]).map((e) => e.id)).toEqual([edition.id]);
  });
});

describe("T2 chain, store and menu rules", () => {
  it("keeps the sample badge until the chain is renamed", async () => {
    const { cookie, body } = await visit();
    const keep = await putChain(req("/api/chain", { cookie, ...json({ name: body.chain.name, brandVoice: ["Plain."], anchors: body.chain.anchors }, { method: "PUT" }) }));
    expect((await keep.json()).isSample).toBe(true);
  });

  it("creates stores with the smallest free colour, trims names and refuses overlong ones", async () => {
    const { cookie, body } = await visit();
    await deleteStore(req("/x", { method: "DELETE", cookie }), params({ id: body.stores[2].id }));
    const ok = await createStore(req("/api/stores", { cookie, ...json({ name: "  Greenpoint ", addressLabel: "Manhattan Ave & Greenpoint Ave", lat: 40.7311, lon: -73.9544 }) }));
    expect(await ok.json()).toMatchObject({ name: "Greenpoint", colorIndex: body.stores[2].colorIndex });
    const long = await createStore(req("/api/stores", { cookie, ...json({ name: "x".repeat(81), addressLabel: "a", lat: 1, lon: 1 }) }));
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ code: "invalid_input" });
  });

  it("caps a workspace at the store limit", async () => {
    const { cookie } = await visit();
    const rows = Array.from({ length: MAX_STORES - 8 }, (_, i) => `Store ${i},${i} Main St,40.7${i % 10},-73.9${i % 10}`).join("\n");
    expect((await importStores(req("/api/stores/import", { cookie, method: "POST", body: `name,address,lat,lon\n${rows}` }))).status).toBe(200);
    const over = await createStore(req("/api/stores", { cookie, ...json({ name: "One too many", addressLabel: "1 Main St", lat: 40.7, lon: -73.9 }) }));
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ code: "store_limit" });
  });

  it("validates menus: duplicate ids are refused", async () => {
    const { cookie, body } = await visit();
    const dup = await putMenu(req("/api/menu", { cookie, ...json([body.menu[0], body.menu[0]], { method: "PUT" }) }));
    expect(dup.status).toBe(400);
    expect(await dup.json()).toMatchObject({ code: "invalid_input" });
    expect((await putMenu(req("/api/menu", { cookie, ...json([], { method: "PUT" }) }))).status).toBe(200);
  });
});
