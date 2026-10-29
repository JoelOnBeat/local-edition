import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, ipLimited, rateLimit } from "@/server/limits";

afterEach(() => vi.unstubAllEnvs());

describe("rateLimit (token bucket in the repo cache)", () => {
  it("allows a burst up to capacity, then throws 429 rate_limited", async () => {
    const opts = { key: "t:burst", capacity: 3, refillPerMinute: 60 };
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) await rateLimit(opts, now);
    await expect(rateLimit(opts, now)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("refills with time: one token per second at 60/min", async () => {
    const opts = { key: "t:refill", capacity: 2, refillPerMinute: 60 };
    await rateLimit(opts, 0);
    await rateLimit(opts, 0);
    await expect(rateLimit(opts, 500)).rejects.toMatchObject({ status: 429 });
    await rateLimit(opts, 1500); // 1.5 s earned >= 1 token
    await expect(rateLimit(opts, 1500)).rejects.toMatchObject({ status: 429 });
  });

  it("buckets are independent per key", async () => {
    await rateLimit({ key: "menu:ip:203.0.113.9", capacity: 1, refillPerMinute: 1 }, 0);
    await rateLimit({ key: "menu:ip:203.0.113.10", capacity: 1, refillPerMinute: 1 }, 0);
    await expect(rateLimit({ key: "menu:ip:203.0.113.9", capacity: 1, refillPerMinute: 1 }, 0)).rejects.toMatchObject({ status: 429 });
  });

  it("concurrent callers cannot overdraw the bucket inside one isolate", async () => {
    const opts = { key: "t:race", capacity: 5, refillPerMinute: 1 };
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => rateLimit(opts, 0)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
  });
});

describe("clientIp", () => {
  const withHeaders = (h: Record<string, string>) => new Request("http://t.test/x", { headers: h });

  it("production trusts cf-connecting-ip only; x-forwarded-for and x-real-ip are ignored", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(clientIp(withHeaders({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6" }))).toBe("198.51.100.7");
    expect(clientIp(withHeaders({ "x-forwarded-for": "6.6.6.6" }))).toBe("unknown");
    expect(clientIp(withHeaders({ "x-real-ip": "6.6.6.6" }))).toBe("unknown");
    expect(clientIp(withHeaders({}))).toBe("unknown");
  });

  it("outside production the forwarded headers work for local proxies and tests", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "10.0.0.5, 10.0.0.1" }))).toBe("10.0.0.5");
    expect(clientIp(withHeaders({ "cf-connecting-ip": "10.0.0.9", "x-forwarded-for": "10.0.0.5" }))).toBe("10.0.0.9");
  });

  it("refuses values that are not an address (header junk never becomes a bucket key)", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "<script>alert(1)</script>" }))).toBe("unknown");
  });
});

describe("ipLimited", () => {
  it("answers 429 {error, code} BEFORE the handler runs once the IP bucket is empty", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = ipLimited({ name: "t-route", capacity: 2, refillPerMinute: 1 }, handler);
    const call = (ip: string) => wrapped(new Request("http://t.test/x", { headers: { "cf-connecting-ip": ip } }));
    expect((await call("203.0.113.1")).status).toBe(200);
    expect((await call("203.0.113.1")).status).toBe(200);
    const blocked = await call("203.0.113.1");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: "rate_limited", error: expect.any(String) });
    expect(handler).toHaveBeenCalledTimes(2);
    expect((await call("203.0.113.2")).status).toBe(200); // another IP is unaffected
  });
});
