import { describe, expect, it } from "vitest";
import { guestRoute, meRoute, signinRoute, signoutRoute, signupRoute } from "@/server/auth/handlers";
import { getWorkspace } from "@/server/handlers/workspace";
import { Jar, PASSWORD, call, signupBody, authRig } from "./helpers";

const rig = authRig();

const signup = (jar: Jar, over: Record<string, unknown> = {}, ip = "198.51.100.7") => call(signupRoute, "/api/auth/signup", { body: signupBody(over), jar, ip });
const signin = (jar: Jar, body: Record<string, unknown>, ip = "198.51.100.7") => call(signinRoute, "/api/auth/signin", { body, jar, ip });

describe("sign-up", () => {
  it("creates the user, an empty chain workspace they own and a session", async () => {
    const jar = new Jar();
    const res = await signup(jar);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ user: { name: "Maya Okafor", email: "maya@kettleandkiln.example" }, keptWorkspace: false });
    expect(body.workspaceId).toMatch(/^acct_/);
    expect(JSON.stringify(body)).not.toContain(PASSWORD);

    const ws = await (await call(getWorkspace, "/api/workspace", { jar })).json();
    expect(ws.workspace.id).toBe(body.workspaceId);
    expect(ws.chain).toMatchObject({ name: "Kettle & Kiln", isSample: false, brandVoice: [], anchors: [] });
    expect(ws.stores).toEqual([]);
    expect(ws.menu).toEqual([]);
  });

  it("sets an HttpOnly, SameSite=Lax session cookie, Secure over https, and stores only a hash of its token", async () => {
    const jar = new Jar();
    const res = await call(signupRoute, "/api/auth/signup", { body: signupBody(), jar, headers: { "x-forwarded-proto": "https" } });
    const sid = res.headers.getSetCookie().find((c) => c.startsWith("le_sid="))!;
    expect(sid).toContain("HttpOnly");
    expect(sid).toContain("SameSite=Lax");
    expect(sid).toContain("Secure");
    expect(sid).toContain("Path=/");
    const plain = await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "other@kettleandkiln.example" }) });
    expect(plain.headers.getSetCookie().find((c) => c.startsWith("le_sid="))).not.toContain("Secure"); // plain http in dev
    // The cookie token is nowhere in the database.
    const token = jar.get("le_sid")!;
    const keys = await rig.kv.list("sess:");
    expect(keys).toHaveLength(2);
    expect(keys.some((k) => k.includes(token))).toBe(false);
  });

  it("normalises the email: case, spaces and composed characters are one address", async () => {
    expect((await signup(new Jar(), { email: "  Maya@KettleAndKiln.example " })).status).toBe(200);
    const again = await signup(new Jar(), { email: "MAYA@kettleandkiln.EXAMPLE" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "That email already has an account. Sign in instead.", code: "email_taken" });
  });

  it("validates every field and answers { error, code } without echoing the password", async () => {
    const cases: Record<string, unknown>[] = [
      { email: "not-an-email" }, { password: "short" }, { password: "x".repeat(129) }, { name: "   " }, { chainName: "" }, { chainName: "x".repeat(81) },
    ];
    for (const over of cases) {
      const res = await signup(new Jar(), over);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_input");
      expect(Object.keys(body).sort()).toEqual(["code", "error"]);
      expect(JSON.stringify(body)).not.toContain(PASSWORD);
    }
    expect((await call(signupRoute, "/api/auth/signup", { body: { nope: 1 } })).status).toBe(400);
    const bad = await signupRoute(new Request("http://localhost/api/auth/signup", { method: "POST", body: "{broken", headers: { "content-type": "application/json" } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("invalid_json");
  });

  it("brings a visitor's sample workspace into the account when asked, and only then", async () => {
    const keepJar = new Jar();
    await call(guestRoute, "/api/auth/guest", { method: "POST", jar: keepJar }); // "Try the sample chain"
    const sample = await (await call(getWorkspace, "/api/workspace", { jar: keepJar })).json();
    expect(sample.chain.isSample).toBe(true);
    const me = await (await call(meRoute, "/api/auth/me", { jar: keepJar })).json();
    expect(me).toMatchObject({ user: null, session: "guest", canKeepWorkspace: true, workspace: { id: sample.workspace.id, kind: "sample" } });

    const res = await signup(keepJar, { keepWorkspace: true });
    const result = await res.json();
    expect(result.keptWorkspace).toBe(true);
    const kept = await (await call(getWorkspace, "/api/workspace", { jar: keepJar })).json();
    expect(kept.workspace.id).toBe(result.workspaceId);
    expect(kept.chain.name).toBe("Kettle & Kiln");
    expect(kept.stores).toHaveLength(8);
    expect(kept.menu.length).toBeGreaterThan(10);
    expect(new Set(kept.stores.map((s: { id: string }) => s.id)).size).toBe(8);
    expect(kept.stores.every((s: { id: string }) => !sample.stores.some((o: { id: string }) => o.id === s.id))).toBe(true);
    // The visitor's own workspace is gone: nobody can come back to it with the old cookie.
    expect(await rig.repo.getWorkspace(sample.workspace.id)).toBeNull();

    // Not asked: the account starts empty even though the visitor had a sample.
    const emptyJar = new Jar();
    await call(guestRoute, "/api/auth/guest", { method: "POST", jar: emptyJar });
    await signup(emptyJar, { email: "second@kettleandkiln.example" });
    expect((await (await call(getWorkspace, "/api/workspace", { jar: emptyJar })).json()).stores).toEqual([]);
  });
});

describe("sign-in, me, sign-out", () => {
  it("signs in with the right password, in any email case, and rotates the session", async () => {
    const first = new Jar();
    await signup(first);
    const firstToken = first.get("le_sid")!;
    const res = await signin(first, { email: "MAYA@kettleandkiln.example", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(first.get("le_sid")).not.toBe(firstToken);
    expect(first.get("le_ws")).toMatch(/^acct_/);
    // The old token no longer works: a session id fixed before sign-in is useless.
    const stale = new Jar();
    stale.set("le_sid", firstToken);
    expect((await (await call(meRoute, "/api/auth/me", { jar: stale })).json()).user).toBeNull();
    expect((await (await call(meRoute, "/api/auth/me", { jar: first })).json()).user.email).toBe("maya@kettleandkiln.example");
  });

  it("answers wrong password and unknown email identically", async () => {
    await signup(new Jar());
    const wrong = await signin(new Jar(), { email: "maya@kettleandkiln.example", password: "not the password" });
    const unknown = await signin(new Jar(), { email: "nobody@kettleandkiln.example", password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("sign-out ends the session server-side and clears both cookies", async () => {
    const jar = new Jar();
    await signup(jar);
    const token = jar.get("le_sid")!;
    const res = await call(signoutRoute, "/api/auth/signout", { method: "POST", jar });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().filter((c) => c.includes("Max-Age=0")).map((c) => c.split("=")[0]).sort()).toEqual(["le_sid", "le_ws"]);
    expect(jar.get("le_sid")).toBeUndefined();
    const replay = new Jar();
    replay.set("le_sid", token); // someone who copied the cookie before sign-out
    expect((await (await call(meRoute, "/api/auth/me", { jar: replay })).json()).user).toBeNull();
    expect((await call(signoutRoute, "/api/auth/signout", { method: "POST", jar: new Jar() })).status).toBe(200); // idempotent
  });

  it("me never creates a workspace and ignores a forged session cookie", async () => {
    const jar = new Jar();
    jar.set("le_sid", "A".repeat(43));
    const res = await call(meRoute, "/api/auth/me", { jar });
    expect(await res.json()).toEqual({ user: null, session: null, onboardingComplete: null, codeSignIn: true, workspace: null, canKeepWorkspace: false });
    expect(res.headers.getSetCookie()).toEqual([]);
    jar.set("le_sid", "short");
    expect((await (await call(meRoute, "/api/auth/me", { jar })).json()).user).toBeNull();
  });

  it("refuses state-changing requests that come from another site", async () => {
    const cross = { origin: "https://evil.example" };
    for (const [handler, path, body] of [[signinRoute, "/api/auth/signin", { email: "a@b.co", password: "x" }], [signupRoute, "/api/auth/signup", signupBody()], [signoutRoute, "/api/auth/signout", undefined]] as const) {
      const res = await call(handler, path, { method: "POST", body, headers: cross });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("bad_origin");
    }
    expect((await call(signoutRoute, "/api/auth/signout", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await call(signoutRoute, "/api/auth/signout", { method: "POST", headers: { origin: "http://localhost" } })).status).toBe(200);
  });
});
