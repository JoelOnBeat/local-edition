import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthStore } from "@/server/auth";
import { MAX_SESSIONS_PER_USER, SESSION_REFRESH_AFTER_MS, SESSION_TTL_MS, getPrincipal, issueSession, sha256Hex } from "@/server/auth/sessions";
import { meRoute, signinRoute, signupRoute } from "@/server/auth/handlers";
import { Jar, PASSWORD, call, signupBody, authRig } from "./helpers";

const rig = authRig();
const at = (token: string) => new Request("http://localhost/x", { headers: { cookie: `le_sid=${token}` } });

async function user() {
  const store = await getAuthStore();
  await store.createUser({ id: "user_t1", email: "t1@example.com", name: "T", passwordHash: "x", workspaceId: "acct_t1", createdAt: "2026-10-30T00:00:00.000Z" });
  return store;
}

describe("sessions", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-30T09:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("resolves a good token to its user and workspace, and a stranger's token to nothing", async () => {
    const store = await user();
    const { token } = await issueSession(store, "user_t1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const p = await getPrincipal(at(token));
    expect(p?.user.id).toBe("user_t1");
    expect(p?.workspaceId).toBe("acct_t1");
    expect(await getPrincipal(at("B".repeat(43)))).toBeNull();
    expect(await getPrincipal(new Request("http://localhost/x"))).toBeNull();
  });

  it("keeps only the SHA-256 of the token", async () => {
    const store = await user();
    const { token } = await issueSession(store, "user_t1");
    const keys = await rig.kv.list("sess:");
    expect(keys).toEqual([`sess:${await sha256Hex(token)}`]);
    expect(JSON.stringify(await rig.kv.get(keys[0]))).not.toContain(token);
  });

  it("expires after 30 days and deletes the dead row", async () => {
    const store = await user();
    const { token } = await issueSession(store, "user_t1");
    vi.setSystemTime(Date.now() + SESSION_TTL_MS - 1000);
    expect(await getPrincipal(at(token))).not.toBeNull();
    vi.setSystemTime(Date.now() + 2000 + SESSION_TTL_MS);
    expect(await getPrincipal(at(token))).toBeNull();
    expect(await rig.kv.list("sess:")).toEqual([]);
  });

  it("pushes an in-use session forward, at most once a day", async () => {
    const store = await user();
    const { token } = await issueSession(store, "user_t1");
    const id = await sha256Hex(token);
    const first = (await store.findSession(id))!.session;
    vi.setSystemTime(Date.now() + 3600_000);
    await getPrincipal(at(token));
    expect((await store.findSession(id))!.session.expiresAt).toBe(first.expiresAt); // under a day: untouched
    vi.setSystemTime(Date.now() + SESSION_REFRESH_AFTER_MS);
    await getPrincipal(at(token));
    expect((await store.findSession(id))!.session.expiresAt).toBeGreaterThan(first.expiresAt);
  });

  it("keeps a user to the newest ten sessions", async () => {
    const store = await user();
    const tokens: string[] = [];
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 3; i++) {
      vi.setSystemTime(Date.now() + 1000);
      tokens.push((await issueSession(store, "user_t1")).token);
    }
    expect(await rig.kv.list("sess:")).toHaveLength(MAX_SESSIONS_PER_USER);
    expect(await getPrincipal(at(tokens[0]))).toBeNull();
    expect(await getPrincipal(at(tokens.at(-1)!))).not.toBeNull();
  });

  it("a malformed cookie is no session at all", async () => {
    await user();
    for (const bad of ["", "a", "%E0%A4%A", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "!"]) {
      expect(await getPrincipal(at(bad))).toBeNull();
    }
  });

  it("is rotated by sign-in and by a second sign-up from the same browser", async () => {
    const jar = new Jar();
    await call(signupRoute, "/api/auth/signup", { body: signupBody(), jar });
    const first = jar.get("le_sid")!;
    await call(signinRoute, "/api/auth/signin", { body: { email: "maya@kettleandkiln.example", password: PASSWORD }, jar });
    expect(jar.get("le_sid")).not.toBe(first);
    expect((await (await call(meRoute, "/api/auth/me", { jar })).json()).user).not.toBeNull();
    await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "b@kettleandkiln.example" }), jar });
    expect((await (await call(meRoute, "/api/auth/me", { jar })).json()).user.email).toBe("b@kettleandkiln.example");
    expect(await rig.kv.list("sess:")).toHaveLength(1); // the browser's earlier session (the first user's) was revoked, not left behind
  });
});
