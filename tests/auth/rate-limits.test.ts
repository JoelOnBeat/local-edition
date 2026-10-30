import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signinRoute, signupRoute } from "@/server/auth/handlers";
import { getAuthStore } from "@/server/auth";
import { FAILURES, WINDOWS, assertNotLocked, failureKeys } from "@/server/auth/throttle";
import { PASSWORD, call, signupBody, authRig } from "./helpers";

authRig();
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-30T09:00:00Z"), toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

const signin = (body: Record<string, unknown>, ip?: string) => call(signinRoute, "/api/auth/signin", { body, ip });
const wrong = (email = "maya@kettleandkiln.example", ip?: string) => signin({ email, password: "definitely not it" }, ip);
const tick = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("sign-up limits", () => {
  it("allows ten sign-ups an hour from one network, then 429 rate_limited with Retry-After", async () => {
    for (let i = 0; i < WINDOWS.signupIp.limit; i++) {
      expect((await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: `u${i}@kettleandkiln.example` }), ip: "203.0.113.5" })).status).toBe(200);
    }
    const blocked = await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "late@kettleandkiln.example" }), ip: "203.0.113.5" });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another network is unaffected, and the first one is free again after the window.
    expect((await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "elsewhere@kettleandkiln.example" }), ip: "203.0.113.6" })).status).toBe(200);
    tick(WINDOWS.signupIp.windowMs + 1000);
    expect((await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "later@kettleandkiln.example" }), ip: "203.0.113.5" })).status).toBe(200);
  });

  it("counts an IPv6 client by its /64: rotating the low bits buys nothing", async () => {
    for (let i = 0; i < WINDOWS.signupIp.limit; i++) {
      const res = await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: `v${i}@kettleandkiln.example` }), ip: `2001:db8:1:2:${i.toString(16)}:aaaa:bbbb:cccc` });
      expect(res.status).toBe(200);
    }
    const next = await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "v-late@kettleandkiln.example" }), ip: "2001:db8:1:2:ffff:1:2:3" });
    expect(next.status).toBe(429);
    expect((await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "v-other@kettleandkiln.example" }), ip: "2001:db8:1:3::1" })).status).toBe(200); // a different /64
  });

  it("limits repeated sign-ups for one address, whichever network asks", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < WINDOWS.signupEmail.limit + 2; i++) statuses.push((await call(signupRoute, "/api/auth/signup", { body: signupBody(), ip: `198.51.100.${i + 10}` })).status);
    expect(statuses.slice(0, 2)).toEqual([200, 409]);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("sign-in limits and back-off", () => {
  async function account() {
    await call(signupRoute, "/api/auth/signup", { body: signupBody(), ip: "192.0.2.1" });
  }

  it("locks an email after five wrong passwords, even for the right one, and says how long", async () => {
    await account();
    for (let i = 0; i < FAILURES.emailThreshold; i++) expect((await wrong()).status).toBe(401);
    const locked = await signin({ email: "maya@kettleandkiln.example", password: PASSWORD });
    expect(locked.status).toBe(429);
    expect((await locked.json()).code).toBe("too_many_attempts");
    expect(Number(locked.headers.get("retry-after"))).toBe(30);
    // The lock lifts after the wait, and a correct password then clears the count.
    tick(31_000);
    expect((await signin({ email: "maya@kettleandkiln.example", password: PASSWORD })).status).toBe(200);
    tick(WINDOWS.signinEmail.windowMs + 1000); // a fresh request window; only the failure counter is under test
    for (let i = 0; i < FAILURES.emailThreshold - 1; i++) await wrong();
    expect((await signin({ email: "maya@kettleandkiln.example", password: PASSWORD })).status).toBe(200); // not locked: the counter restarted
  });

  it("doubles the wait with each further failure, and caps it at fifteen minutes", async () => {
    await account();
    for (let i = 0; i < FAILURES.emailThreshold; i++) await wrong();
    const waits: number[] = [];
    for (let round = 0; round < 3; round++) {
      const locked = await wrong();
      expect(locked.status).toBe(429);
      const wait = Number(locked.headers.get("retry-after"));
      waits.push(wait);
      tick(wait * 1000 + 1000);
      if (round > 0) tick(WINDOWS.signinEmail.windowMs); // keep the request window out of the way: only back-off is under test
      expect((await wrong()).status).toBe(401); // the lock lifted, so this one is a real (failed) try and lengthens the next wait
    }
    expect(waits).toEqual([30, 60, 120]);

    const store = await getAuthStore();
    const keys = await failureKeys("capped@kettleandkiln.example", null);
    for (let i = 0; i < 15; i++) await store.fail(keys.email, FAILURES.forgetMs, Date.now());
    await expect(assertNotLocked(store, keys)).rejects.toMatchObject({ code: "too_many_attempts", retryAfterSeconds: FAILURES.capMs / 1000 });
  });

  it("forgets failures after an hour", async () => {
    await account();
    for (let i = 0; i < FAILURES.emailThreshold - 1; i++) await wrong();
    tick(FAILURES.forgetMs + 1000);
    for (let i = 0; i < FAILURES.emailThreshold - 1; i++) expect((await wrong()).status).toBe(401);
  });

  it("applies the same lock to an address that has no account, so it cannot be used to find accounts", async () => {
    for (let i = 0; i < FAILURES.emailThreshold; i++) await wrong("ghost@kettleandkiln.example");
    expect((await wrong("ghost@kettleandkiln.example")).status).toBe(429);
  });

  it("limits sign-in requests per network and per email in a window", async () => {
    await account();
    const ip = "203.0.113.50";
    let last = 200;
    for (let i = 0; i < WINDOWS.signinIp.limit + 1; i++) last = (await signin({ email: `p${i}@kettleandkiln.example`, password: "whatever it is" }, ip)).status;
    expect(last).toBe(429);
    // Per-email window: ten tries from ten networks, the eleventh is refused (before any password is checked).
    let emailStatus = 0;
    for (let i = 0; i < WINDOWS.signinEmail.limit + 1; i++) emailStatus = (await signin({ email: "burst@kettleandkiln.example", password: "x" }, `198.18.0.${i + 1}`)).status;
    expect(emailStatus).toBe(429);
  });

  it("a network that keeps failing across many emails is locked too", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < FAILURES.ipThreshold; i++) await wrong(`n${i}@kettleandkiln.example`, ip);
    const res = await wrong("fresh@kettleandkiln.example", ip);
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("too_many_attempts");
  });
});
