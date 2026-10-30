import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { middleware } from "@/middleware";
import { isProtectedPage, isPublicApi, safeNext, signinUrl } from "@/lib/session-paths";
import { guestRoute, meRoute, signoutRoute, signupRoute } from "@/server/auth/handlers";
import { getWorkspace } from "@/server/handlers/workspace";
import { POST as squareWebhook } from "@/app/api/connectors/square/webhook/route";
import { POST as slackInteractions } from "@/app/api/connectors/slack/interactions/route";
import { POST as mailWebhook } from "@/app/api/connectors/mail/webhook/route";
import { GET as jobsPending } from "@/app/api/jobs/pending/route";
import { Jar, call, signupBody, authRig } from "./helpers";

authRig();

const asNext = (path: string, cookie?: string, init: RequestInit = {}) =>
  new NextRequest(`http://localhost${path}`, { ...(init as ConstructorParameters<typeof NextRequest>[1]), headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string> | undefined) } });
const passes = (res: NextResponse) => res.headers.get("x-middleware-next") === "1";

/** The wall in front of the handlers, as the platform runs it: middleware first, the handler only when it lets the request through. */
async function viaMiddleware(path: string, cookie: string | undefined, handler: (r: Request) => Promise<Response>, init: RequestInit = {}): Promise<Response> {
  const gate = middleware(asNext(path, cookie, init));
  return passes(gate) ? handler(new Request(`http://localhost${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string> | undefined) } })) : gate;
}

describe("path rules", () => {
  it("protects /app and /onboarding, nothing else", () => {
    for (const p of ["/app", "/app/", "/app/stores/store_x", "/app/compare", "/onboarding"]) expect(isProtectedPage(p), p).toBe(true);
    for (const p of ["/", "/signin", "/signup", "/privacy", "/terms", "/proof", "/limits", "/card/abc", "/application", "/apple"]) expect(isProtectedPage(p), p).toBe(false);
  });

  it("keeps an explicit allowlist of open API paths", () => {
    const open = [
      "/api/auth/me", "/api/auth/signin", "/api/auth/signup", "/api/auth/signout", "/api/auth/guest", "/api/auth/code/request", "/api/auth/code/verify",
      "/api/connectors/square/webhook", "/api/connectors/slack/interactions", "/api/connectors/mail/webhook",
      "/api/connectors/square/callback", "/api/connectors/slack/callback", "/api/connectors/mail/callback",
      "/api/jobs/monday", "/api/jobs/pending", "/api/jobs/results", "/api/jobs/eval", "/api/jobs/latest",
      "/api/card/t7k2m9xqp4", "/api/calendar/abc123.ics", "/api/status", "/api/proof", "/api/limits",
    ];
    for (const p of open) expect(isPublicApi(p), p).toBe(true);
    const closed = [
      "/api/workspace", "/api/chain", "/api/stores", "/api/stores/x", "/api/menu", "/api/menu/read", "/api/editions", "/api/editions/build", "/api/editions/e1/approve-all",
      "/api/anchors/search", "/api/compare", "/api/connections", "/api/account", "/api/onboarding", "/api/connectors/square/connect", "/api/connectors/square/sync",
      "/api/connectors/slack/install", "/api/connectors/slack/digest", "/api/connectors/mail/connect", "/api/connectors/mail/poll", "/api/connectors/comms",
      "/api/connectors/deliveries", "/api/connectors/calendar", "/api/chain/brand-voice", "/api/card", "/api/card/a/b", "/api/authx", "/api/status/extra",
    ];
    for (const p of closed) expect(isPublicApi(p), p).toBe(false);
  });

  it("follows `next` only to a path under /app on this site", () => {
    expect(safeNext("/app")).toBe("/app");
    expect(safeNext("/app/stores/store_williamsburg?week=2026-10-26")).toBe("/app/stores/store_williamsburg?week=2026-10-26");
    for (const bad of ["https://evil.example/app", "//evil.example/app", "/\\evil.example", "/app\n/x", "/application", "/appx", "/signin", "/onboarding", "app", "", null, undefined, "/app/../../etc", "javascript:alert(1)"]) {
      expect(safeNext(bad as string | null | undefined), String(bad)).toBeNull();
    }
    expect(signinUrl("/app/compare")).toBe("/signin?next=%2Fapp%2Fcompare");
    expect(signinUrl("https://evil.example")).toBe("/signin");
  });
});

describe("state 1: signed out", () => {
  it("redirects /app/* to /signin?next=<path> (query kept) and /onboarding to /signin", () => {
    const home = middleware(asNext("/app"));
    expect(home.status).toBe(307);
    expect(home.headers.get("location")).toBe("http://localhost/signin?next=%2Fapp");
    const deep = middleware(asNext("/app/stores/store_williamsburg?week=2026-10-26"));
    expect(deep.headers.get("location")).toBe("http://localhost/signin?next=%2Fapp%2Fstores%2Fstore_williamsburg%3Fweek%3D2026-10-26");
    expect(middleware(asNext("/onboarding")).headers.get("location")).toBe("http://localhost/signin");
  });

  it("lets public pages through", () => {
    for (const p of ["/", "/signin", "/signup", "/privacy", "/terms", "/proof", "/limits", "/card/abc"]) expect(passes(middleware(asNext(p))), p).toBe(true);
  });

  it("refuses data routes with 401 { error, code }, before any handler runs", async () => {
    for (const [method, p] of [["GET", "/api/workspace"], ["PUT", "/api/chain"], ["POST", "/api/editions/build"], ["GET", "/api/connections"], ["DELETE", "/api/account"], ["POST", "/api/connectors/slack/digest"], ["GET", "/api/anchors/search?q=blue"]] as const) {
      const res = middleware(asNext(p, undefined, { method }));
      expect(res.status, p).toBe(401);
      expect(await res.json()).toEqual({ error: "Sign in to continue.", code: "unauthenticated" });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("keeps the allowlist open", () => {
    for (const p of ["/api/auth/me", "/api/auth/guest", "/api/jobs/pending", "/api/card/tok", "/api/calendar/tok", "/api/status", "/api/proof", "/api/limits", "/api/connectors/square/webhook"]) {
      expect(passes(middleware(asNext(p))), p).toBe(true);
    }
  });

  it("answers /api/auth/me with a null session and the handlers themselves also refuse", async () => {
    const me = await (await call(meRoute, "/api/auth/me")).json();
    expect(me).toMatchObject({ user: null, session: null, workspace: null });
    const direct = await call(getWorkspace, "/api/workspace"); // middleware bypassed: the handler is the second wall
    expect(direct.status).toBe(401);
    expect((await direct.json()).code).toBe("unauthenticated");
  });
});

describe("state 2: signed in (account and guest)", () => {
  it("an account passes the middleware and reads its data", async () => {
    const jar = new Jar();
    await call(signupRoute, "/api/auth/signup", { body: signupBody(), jar });
    expect(passes(middleware(asNext("/app", jar.header())))).toBe(true);
    expect(passes(middleware(asNext("/onboarding", jar.header())))).toBe(true);
    const res = await viaMiddleware("/api/workspace", jar.header(), (r) => getWorkspace(r));
    expect(res.status).toBe(200);
    expect((await res.json()).chain.name).toBe("Kettle & Kiln");
  });

  it("\"Try the sample chain\" is a real guest session: it passes the same middleware and gets a private sample workspace", async () => {
    const jar = new Jar();
    const made = await call(guestRoute, "/api/auth/guest", { method: "POST", jar, ip: "198.51.100.20" });
    expect(made.status).toBe(200);
    expect(await made.json()).toMatchObject({ session: "guest", workspaceId: expect.stringMatching(/^ws_/) });
    const raw = made.headers.getSetCookie().find((c) => c.startsWith("le_sid="))!;
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Lax");
    expect(passes(middleware(asNext("/app", jar.header())))).toBe(true);
    const ws = await viaMiddleware("/api/workspace", jar.header(), (r) => getWorkspace(r));
    expect(ws.status).toBe(200);
    const body = await ws.json();
    expect(body.chain.isSample).toBe(true);
    expect(body.stores).toHaveLength(8);
    expect(await (await call(meRoute, "/api/auth/me", { jar })).json()).toMatchObject({ user: null, session: "guest", onboardingComplete: null, canKeepWorkspace: true });
    // A second click reuses the session instead of minting another workspace.
    const again = await call(guestRoute, "/api/auth/guest", { method: "POST", jar });
    expect((await again.json()).workspaceId).toBe(body.workspace.id);
    expect(again.headers.getSetCookie()).toEqual([]);
  });

  it("limits how many sample chains one network can open", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call(guestRoute, "/api/auth/guest", { method: "POST", ip: "203.0.113.99" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("signing out takes the wall back up", async () => {
    const jar = new Jar();
    await call(signupRoute, "/api/auth/signup", { body: signupBody(), jar });
    await call(signoutRoute, "/api/auth/signout", { method: "POST", jar });
    expect(jar.header()).toBe("");
    expect(middleware(asNext("/app", jar.header())).status).toBe(307);
    expect(middleware(asNext("/api/workspace", jar.header())).status).toBe(401);
  });
});

describe("state 3: an expired or forged cookie", () => {
  const EXPIRED = `le_sid=${"Q".repeat(43)}`;

  it("passes the middleware (it only sees a cookie) and is refused by the handler, so the client guard can send it to sign-in", async () => {
    expect(passes(middleware(asNext("/app", EXPIRED)))).toBe(true);
    const res = await viaMiddleware("/api/workspace", EXPIRED, (r) => getWorkspace(r));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthenticated");
  });

  it("/api/auth/me says there is no session, which is what the guard and the links act on", async () => {
    const res = await viaMiddleware("/api/auth/me", EXPIRED, (r) => meRoute(r));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: null, session: null, onboardingComplete: null });
  });

  it("a session that really expired in the database behaves the same", async () => {
    const jar = new Jar();
    await call(signupRoute, "/api/auth/signup", { body: signupBody(), jar });
    const realNow = Date.now;
    Date.now = () => realNow() + 31 * 24 * 3600 * 1000;
    try {
      expect((await call(getWorkspace, "/api/workspace", { jar })).status).toBe(401);
      expect((await (await call(meRoute, "/api/auth/me", { jar })).json()).session).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});

describe("the allowlisted callbacks still reach their own signature check", () => {
  // With each provider's secret set, an unsigned call must be refused by that provider's check (401/403 + its own code), not by our `unauthenticated`.
  const secrets = {
    SQUARE_WEBHOOK_SIGNATURE_KEY: "square-test-signature-key-0123456789",
    SLACK_SIGNING_SECRET: "slack-test-signing-secret-0123456789",
    COMPOSIO_WEBHOOK_SECRET: "composio-test-webhook-secret-0123456789",
    LE_JOB_SECRET: "job-test-secret-0123456789abcdef0123456789",
    APP_URL: "https://localedition.example",
  };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [k, v] of Object.entries(secrets)) { saved[k] = process.env[k]; process.env[k] = v; }
    resetEnvCache();
  });
  afterEach(() => {
    for (const k of Object.keys(secrets)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    resetEnvCache();
  });

  async function unsigned(path: string, handler: (r: Request) => Promise<Response>, method = "POST", headers: Record<string, string> = {}) {
    const res = await viaMiddleware(path, undefined, handler, { method, body: method === "POST" ? "{}" : undefined, headers: { "content-type": "application/json", ...headers } });
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return { status: res.status, code: body.code, error: body.error };
  }

  it("Square webhook: an unsigned POST fails the signature check", async () => {
    const r = await unsigned("/api/connectors/square/webhook", squareWebhook);
    expect(r).toMatchObject({ status: 401 });
    expect(r.code).not.toBe("unauthenticated");
    expect(r.error).toMatch(/signature/i);
  });

  it("Slack interactivity: an unsigned POST fails Slack's signature check", async () => {
    const r = await unsigned("/api/connectors/slack/interactions", slackInteractions);
    expect(r.status).toBe(401);
    expect(r.code).not.toBe("unauthenticated");
    expect(r.error).toMatch(/signature|slack/i);
  });

  it("Composio mail webhook: an unsigned POST fails the signature check", async () => {
    const r = await unsigned("/api/connectors/mail/webhook", mailWebhook);
    expect(r.status).toBe(401);
    expect(r.code).not.toBe("unauthenticated");
    expect(r.error).toMatch(/signature|webhook/i);
  });

  it("signed job callbacks: no signature is a 400 from the job route's own validation, a wrong one a 401 from its HMAC check", async () => {
    const none = await unsigned("/api/jobs/pending", jobsPending, "GET");
    expect(none.code).toBe("invalid_input");
    const wrong = await unsigned("/api/jobs/pending", jobsPending, "GET", { "x-le-signature": "0".repeat(64), "x-le-timestamp": String(Math.floor(Date.now() / 1000)) });
    expect(wrong.status).toBe(401);
    expect(wrong.code).not.toBe("unauthenticated");
  });

  it("OAuth callbacks reach their own state check (no session needed, the one-use state is the proof)", async () => {
    const { GET: squareCallback } = await import("@/app/api/connectors/square/callback/route");
    const res = await viaMiddleware("/api/connectors/square/callback?code=x&state=nope", undefined, (r) => squareCallback(r));
    expect(res.status).not.toBe(401);
  });
});
