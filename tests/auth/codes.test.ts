import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CODE_RESEND_SECONDS, CODE_TTL_SECONDS, CodeVerifyInput } from "@/contract";
import { codeEmail, CODE_SUBJECT, EmailUnavailableError, setCodeSender } from "@/server/auth/code-sender";
import { newCode } from "@/server/auth/codes";
import { codeRequestRoute, codeVerifyRoute, deleteAccountRoute, meRoute, signinRoute, signupRoute } from "@/server/auth/handlers";
import { getWorkspace } from "@/server/handlers/workspace";
import { guestRoute } from "@/server/auth/handlers";
import { Jar, PASSWORD, call, signupBody, authRig } from "./helpers";

const rig = authRig();
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-30T09:00:00Z"), toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

const EMAIL = "maya@kettleandkiln.example";
const request = (email = EMAIL, jar?: Jar, ip?: string) => call(codeRequestRoute, "/api/auth/code/request", { body: { email }, jar, ip });
const verify = (code: string, email = EMAIL, jar?: Jar, extra: Record<string, unknown> = {}) => call(codeVerifyRoute, "/api/auth/code/verify", { body: { email, code, ...extra }, jar });
const lastCode = () => rig.sent.at(-1)!.code;
const tick = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("asking for a code", () => {
  it("emails six digits once, to the normalised address, and answers the same for any address", async () => {
    const res = await request("  Maya@KettleAndKiln.example ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, resendAfterSeconds: CODE_RESEND_SECONDS, expiresInSeconds: CODE_TTL_SECONDS });
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0]).toMatchObject({ to: EMAIL, expiresInMinutes: 10 });
    expect(rig.sent[0].code).toMatch(/^\d{6}$/);
    // A known address and an unknown one look identical from outside.
    await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "known@kettleandkiln.example" }) });
    expect(await (await request("known@kettleandkiln.example")).json()).toEqual(await (await request("unknown@kettleandkiln.example")).json());
  });

  it("keeps only a hash of the code", async () => {
    await request();
    const stored = JSON.stringify(await rig.kv.get(`code:${EMAIL}`));
    expect(stored).not.toContain(lastCode());
    expect(stored).toContain("codeHash");
  });

  it("the mail is plain, names the product only in the subject, and carries the code", () => {
    const mail = codeEmail({ to: EMAIL, code: "493 027".replace(" ", ""), expiresInMinutes: 10 });
    expect(mail.subject).toBe("Your Local Edition sign-in code");
    expect(CODE_SUBJECT).toBe(mail.subject);
    expect(mail.text).toContain("493027");
    expect(mail.html).toContain("493027");
    expect(mail.text).toContain("10 minutes");
    expect(mail.text).not.toMatch(/https?:\/\//);
  });

  it("makes six-digit codes from the full range, zero-padded", () => {
    const seen = new Set(Array.from({ length: 400 }, () => newCode()));
    expect([...seen].every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(seen.size).toBeGreaterThan(390);
  });

  it("makes you wait for a resend, then replaces the old code", async () => {
    await request();
    const first = lastCode();
    const early = await request();
    expect(early.status).toBe(429);
    expect((await early.json()).code).toBe("rate_limited");
    expect(Number(early.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(rig.sent).toHaveLength(1);
    tick((CODE_RESEND_SECONDS + 1) * 1000);
    expect((await request()).status).toBe(200);
    expect(rig.sent).toHaveLength(2);
    if (first !== lastCode()) expect((await verify(first)).status).toBe(401); // the earlier code is dead
    expect((await verify(lastCode())).status).toBe(200);
  });

  it("limits requests per address and per network", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await request(EMAIL)).status);
      tick((CODE_RESEND_SECONDS + 1) * 1000);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);
    const ipStatuses: number[] = [];
    for (let i = 0; i < 12; i++) ipStatuses.push((await request(`n${i}@kettleandkiln.example`, undefined, "203.0.113.40")).status);
    expect(ipStatuses.at(-1)).toBe(429);
  });
});

describe("email_unavailable and the password fallback", () => {
  it("answers 503 email_unavailable when no sender is configured, and the password path still works", async () => {
    setCodeSender(null);
    const res = await request();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Emailed codes are not available right now. Sign in with your password instead.", code: "email_unavailable" });
    expect(await (await call(meRoute, "/api/auth/me")).json()).toMatchObject({ codeSignIn: false });
    const jar = new Jar();
    await call(signupRoute, "/api/auth/signup", { body: signupBody(), jar });
    await call(signupRoute, "/api/auth/signout", { method: "POST", jar }).catch(() => undefined);
    expect((await call(signinRoute, "/api/auth/signin", { body: { email: EMAIL, password: PASSWORD } })).status).toBe(200);
  });

  it("a sender that fails (revoked token, Gmail down) is the same 503, and leaves no guessable code behind", async () => {
    setCodeSender({ name: "broken", send: async () => { throw new EmailUnavailableError("revoked"); } });
    const res = await request();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("email_unavailable");
    expect(await rig.kv.get(`code:${EMAIL}`)).toBeNull();
    expect((await verify("123456")).status).toBe(401);
  });

  it("a sender that throws anything else is a plain 500, not a leak", async () => {
    setCodeSender({ name: "broken", send: async () => { throw new Error("secret detail xyz"); } });
    const res = await request();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("xyz");
  });
});

describe("verifying a code", () => {
  it("makes the account on first use: empty chain, no password, signed in, onboarding not finished", async () => {
    const jar = new Jar();
    await request(EMAIL, jar);
    const res = await verify(lastCode(), EMAIL, jar);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: true, keptWorkspace: false, user: { email: EMAIL, name: "maya", hasPassword: false } });
    expect(body.workspaceId).toMatch(/^acct_/);
    const sid = res.headers.getSetCookie().find((c) => c.startsWith("le_sid="))!;
    expect(sid).toContain("HttpOnly");
    expect(sid).toContain("SameSite=Lax");
    expect(await (await call(meRoute, "/api/auth/me", { jar })).json()).toMatchObject({ session: "user", onboardingComplete: false, codeSignIn: true });
    const ws = await (await call(getWorkspace, "/api/workspace", { jar })).json();
    expect(ws.stores).toEqual([]);
    expect(ws.chain.name).toBe("My chain");
  });

  it("signs an existing account in (created false), rotating the session", async () => {
    const jar = new Jar();
    await request(EMAIL, jar);
    await verify(lastCode(), EMAIL, jar);
    const first = jar.get("le_sid");
    tick(60_000);
    await request(EMAIL, jar);
    const res = await verify(lastCode(), EMAIL, jar);
    expect((await res.json()).created).toBe(false);
    expect(jar.get("le_sid")).not.toBe(first);
  });

  it("works once: a used code is gone", async () => {
    await request();
    const code = lastCode();
    expect((await verify(code)).status).toBe(200);
    const again = await verify(code);
    expect(again.status).toBe(401);
    expect((await again.json()).code).toBe("code_expired");
  });

  it("expires after ten minutes", async () => {
    await request();
    const code = lastCode();
    tick((CODE_TTL_SECONDS + 1) * 1000);
    const res = await verify(code);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("code_expired");
  });

  it("a wrong code says how many tries are left; five wrong tries burn the code even for the right one", async () => {
    await request();
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    const tries: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await verify(wrong);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("invalid_code");
      tries.push(body.error);
      tick(31_000);
    }
    expect(tries[0]).toContain("4 tries left");
    expect(tries[3]).toContain("1 try left");
    const fifth = await verify(wrong);
    expect((await fifth.json()).code).toBe("code_expired");
    // Straight away the address is also in the failure back-off (429); after the wait the burnt code is simply gone.
    expect((await verify(right)).status).toBe(429);
    tick(31_000);
    const late = await verify(right);
    expect(late.status).toBe(401);
    expect((await late.json()).code).toBe("code_expired");
  });

  it("a code for one address does not open another", async () => {
    await request("a@kettleandkiln.example");
    const code = lastCode();
    expect((await verify(code, "b@kettleandkiln.example")).status).toBe(401);
  });

  it("accepts a pasted code with spaces or dashes and refuses anything that is not six digits", async () => {
    const parsed = (code: string) => CodeVerifyInput.safeParse({ email: EMAIL, code });
    expect(parsed("123 456").success && parsed("123 456").data?.code).toBe("123456");
    expect(parsed("123-456").success && parsed("123-456").data?.code).toBe("123456");
    for (const bad of ["12345", "1234567", "abcdef", "", "12 34 5"]) expect(parsed(bad).success, bad).toBe(false);
    const res = await verify("12ab56");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
  });

  it("locks the address after repeated failures, like a password does", async () => {
    await request();
    for (let i = 0; i < 5; i++) await verify("000000").catch(() => undefined);
    await request().catch(() => undefined);
    const res = await verify("123456");
    expect([401, 429]).toContain(res.status);
  });

  it("brings a guest's sample chain into the new account when asked", async () => {
    const jar = new Jar();
    await call(guestRoute, "/api/auth/guest", { method: "POST", jar });
    await request(EMAIL, jar);
    const res = await verify(lastCode(), EMAIL, jar, { keepWorkspace: true });
    expect(await res.json()).toMatchObject({ created: true, keptWorkspace: true });
    expect((await (await call(getWorkspace, "/api/workspace", { jar })).json()).stores).toHaveLength(8);
    expect(await (await call(meRoute, "/api/auth/me", { jar })).json()).toMatchObject({ session: "user" });
  });
});

describe("an account without a password", () => {
  async function codeAccount() {
    const jar = new Jar();
    await request(EMAIL, jar);
    await verify(lastCode(), EMAIL, jar);
    return jar;
  }

  it("cannot sign in with a password (there is none), and the empty one never matches", async () => {
    await codeAccount();
    for (const password of ["", "anything at all", "pbkdf2-sha256$1$aa$bb"]) {
      const res = await call(signinRoute, "/api/auth/signin", { body: { email: EMAIL, password: password || " " } });
      expect(res.status).toBe(401);
    }
  });

  it("deletes with its email address typed as the confirmation, and refuses a wrong one or a password", async () => {
    const jar = await codeAccount();
    const del = (body: unknown) => call(deleteAccountRoute, "/api/account", { method: "DELETE", jar, body });
    expect((await del({ confirmEmail: "someone@else.example" })).status).toBe(401);
    expect((await del({ password: "whatever" })).status).toBe(401);
    expect((await del({})).status).toBe(400);
    const ok = await del({ confirmEmail: "  MAYA@kettleandkiln.example " });
    expect(ok.status).toBe(200);
    expect((await (await call(meRoute, "/api/auth/me", { jar })).json()).session).toBeNull();
    expect(await rig.kv.get(`uemail:${EMAIL}`)).toBeNull();
  });

  it("an account WITH a password does not accept the email as confirmation", async () => {
    const jar = new Jar();
    await call(signupRoute, "/api/auth/signup", { body: signupBody(), jar });
    const res = await call(deleteAccountRoute, "/api/account", { method: "DELETE", jar, body: { confirmEmail: EMAIL } });
    expect(res.status).toBe(401);
  });
});
