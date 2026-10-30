import { describe, expect, it } from "vitest";
import { guestRoute, meRoute, signoutRoute, signupRoute } from "@/server/auth/handlers";
import { getEdition, listEditions } from "@/server/handlers/editions";
import { createStore, deleteStore, getWorkspace } from "@/server/handlers/workspace";
import { peekWorkspace } from "@/server/session";
import { cardFor, cleanEdition } from "../e/helpers";
import { Jar, call, signupBody, authRig } from "./helpers";

const rig = authRig();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function account(email: string, chainName: string) {
  const jar = new Jar();
  const res = await call(signupRoute, "/api/auth/signup", { body: signupBody({ email, chainName }), jar });
  const { workspaceId } = await res.json();
  const store = await (await call(createStore, "/api/stores", { body: { name: `${chainName} Corner`, addressLabel: "Bedford Ave & N 7th St", lat: 40.7175, lon: -73.9573 }, jar })).json();
  const edition = { ...cleanEdition("store_williamsburg", `ed_${chainName.replace(/\W/g, "").toLowerCase()}`), storeId: store.id };
  await rig.repo.putEdition(edition);
  await rig.repo.putStaffCard(cardFor(edition, `tok_${chainName.replace(/\W/g, "").toLowerCase()}_0001`));
  return { jar, workspaceId, store, edition };
}

describe("cross-tenant access", () => {
  it("a signed-in user is always in their own workspace, whatever le_ws says", async () => {
    const a = await account("a@kettleandkiln.example", "Alder Coffee");
    const b = await account("b@kettleandkiln.example", "Birch Coffee");
    a.jar.set("le_ws", b.workspaceId); // an attacker edits their own cookie to name B's workspace
    const res = await call(getWorkspace, "/api/workspace", { jar: a.jar });
    const body = await res.json();
    expect(body.workspace.id).toBe(a.workspaceId);
    expect(body.chain.name).toBe("Alder Coffee");
    expect(JSON.stringify(body)).not.toContain("Birch");
    expect(a.jar.get("le_ws")).toBe(a.workspaceId); // and the cookie is put right again
  });

  it("holding an account's workspace id without its session opens nothing: 401, not the account", async () => {
    const b = await account("b@kettleandkiln.example", "Birch Coffee");
    const thief = new Jar();
    thief.set("le_ws", b.workspaceId);
    const res = await call(getWorkspace, "/api/workspace", { jar: thief, ip: "203.0.113.9" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to continue.", code: "unauthenticated" });
    // Even as a guest (a real session of their own) the forged cookie names nothing: the guest gets the guest's own sample workspace.
    await call(guestRoute, "/api/auth/guest", { method: "POST", jar: thief, ip: "203.0.113.9" });
    thief.set("le_ws", b.workspaceId);
    const body = await (await call(getWorkspace, "/api/workspace", { jar: thief })).json();
    expect(body.workspace.id).not.toBe(b.workspaceId);
    expect(body.chain.isSample).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Birch");
  });

  it("public read pages never show an account to someone without its session", async () => {
    const b = await account("b@kettleandkiln.example", "Birch Coffee");
    const thief = new Jar();
    thief.set("le_ws", b.workspaceId);
    const seen = await peekWorkspace(new Request("http://localhost/api/proof", { headers: { cookie: thief.header() } }), rig.repo);
    expect(seen?.id).not.toBe(b.workspaceId);
    const owner = await peekWorkspace(new Request("http://localhost/api/proof", { headers: { cookie: b.jar.header() } }), rig.repo);
    expect(owner?.id).toBe(b.workspaceId);
  });

  it("another account's store and edition ids are plain 404s", async () => {
    const a = await account("a@kettleandkiln.example", "Alder Coffee");
    const b = await account("b@kettleandkiln.example", "Birch Coffee");
    const del = await call(deleteStore, `/api/stores/${b.store.id}`, { method: "DELETE", jar: a.jar, params: { id: b.store.id } });
    expect(del.status).toBe(404);
    expect(await rig.repo.getStore(b.store.id)).not.toBeNull(); // still there
    const read = await getEdition(new Request(`http://localhost/api/editions/${b.edition.id}`, { headers: { cookie: a.jar.header() } }), params({ id: b.edition.id }));
    expect(read.status).toBe(404);
    const list = await (await call(listEditions, "/api/editions", { jar: a.jar })).json();
    expect(list.map((e: { id: string }) => e.id)).toEqual([a.edition.id]);
    // The owner still reads their own.
    const own = await getEdition(new Request(`http://localhost/api/editions/${b.edition.id}`, { headers: { cookie: b.jar.header() } }), params({ id: b.edition.id }));
    expect(own.status).toBe(200);
  });

  it("a sample visitor's workspace and an account's never overlap, and signing out leaves no way back in", async () => {
    const a = await account("a@kettleandkiln.example", "Alder Coffee");
    const staleCookie = a.jar.header();
    await call(signoutRoute, "/api/auth/signout", { method: "POST", jar: a.jar });
    // The copied cookie pair (session and workspace) is dead: no session, and an acct_ id alone opens nothing.
    const replay = await getWorkspace(new Request("http://localhost/api/workspace", { headers: { cookie: staleCookie, "cf-connecting-ip": "203.0.113.10" } }));
    expect(replay.status).toBe(401);
    const me = await (await call(meRoute, "/api/auth/me", { headers: { cookie: staleCookie } })).json();
    expect(me.user).toBeNull();
    expect(me.workspace).toBeNull(); // me does not hand out the account workspace to a cookie without a session
  });

  it("an account whose workspace vanished is rebuilt empty under the same id instead of failing sign-in", async () => {
    const a = await account("a@kettleandkiln.example", "Alder Coffee");
    await rig.repo.deleteWorkspace(a.workspaceId);
    const body = await (await call(getWorkspace, "/api/workspace", { jar: a.jar })).json();
    expect(body.workspace.id).toBe(a.workspaceId);
    expect(body.stores).toEqual([]);
  });

  it("account rows never expire, visitor rows still do", async () => {
    const { isVisitorId } = await import("@/server/store/ids");
    const a = await account("a@kettleandkiln.example", "Alder Coffee");
    expect(isVisitorId(a.workspaceId)).toBe(false);
    expect(isVisitorId(a.store.id)).toBe(false);
    expect(isVisitorId("ws_abc")).toBe(true);
    expect(isVisitorId("store_x~abc")).toBe(true);
  });
});
