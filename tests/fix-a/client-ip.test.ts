import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, ipBucket } from "@/server/limits";
import { GLOBAL_WORKSPACES_PER_HOUR, resolveWorkspace, takeGlobalWorkspaceSlot } from "@/server/session";
import { createMemoryRepo } from "@/server/store/memory";

/** M5: IPv6 clients are keyed by their /64; a global cap on new workspaces per hour. */

afterEach(() => vi.unstubAllEnvs());

describe("ipBucket", () => {
  it("leaves IPv4 alone", () => {
    expect(ipBucket("203.0.113.9")).toBe("203.0.113.9");
  });

  it("keys IPv6 by the first four hextets, however the address is written", () => {
    const same = [
      "2001:db8:1:2:aaaa:bbbb:cccc:dddd",
      "2001:0DB8:0001:0002::1",
      "2001:db8:1:2::",
      "2001:db8:1:2:0:0:0:ffff",
      "2001:db8:1:2:ffff:ffff:ffff:ffff",
    ].map(ipBucket);
    expect(new Set(same)).toEqual(new Set(["2001:db8:1:2::/64"]));
  });

  it("separates different /64 prefixes", () => {
    expect(ipBucket("2001:db8:1:2::1")).not.toBe(ipBucket("2001:db8:1:3::1"));
    expect(ipBucket("2001:db8:1:2::1")).not.toBe(ipBucket("2001:db8:2:2::1"));
  });

  it("handles compression at the front, the middle and the back", () => {
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("fe80::")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("1:2:3:4:5:6:7:8")).toBe("1:2:3:4::/64");
  });

  it("reads an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(ipBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket("0:0:0:0:0:ffff:cb00:7109")).toBe("203.0.113.9");
  });

  it("answers 'unknown' for text that is not an address instead of throwing", () => {
    for (const bad of ["1:2:3:4:5:6:7:8:9", "1::2::3", "gggg::1", "1:2:3", "::ffff:999.1.1.1", ":::"]) expect(ipBucket(bad)).toBe("unknown");
  });
});

describe("clientIp", () => {
  const req = (h: Record<string, string>) => new Request("http://t.test/x", { headers: h });

  it("buckets a production cf-connecting-ip IPv6 address by its /64", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(clientIp(req({ "cf-connecting-ip": "2001:db8:a:b:1:2:3:4" }))).toBe("2001:db8:a:b::/64");
    expect(clientIp(req({ "cf-connecting-ip": "2001:db8:a:b:ffff:eeee:dddd:cccc" }))).toBe("2001:db8:a:b::/64");
  });

  it("buckets outside production too, for x-forwarded-for", () => {
    expect(clientIp(req({ "x-forwarded-for": "2001:db8:a:b:1:2:3:4, 10.0.0.1" }))).toBe("2001:db8:a:b::/64");
  });
});

describe("the new-workspace limit follows the /64, not the address", () => {
  const from = (ip: string) => new Request("http://t.test/api/workspace", { headers: { "x-forwarded-for": ip } });
  const limit = { capacity: 2, refillSeconds: 3600 };

  it("an IPv6 client that rotates the low 64 bits gets two workspaces, not one per address", async () => {
    const repo = createMemoryRepo();
    await resolveWorkspace(from("2001:db8:7:7:1111:1111:1111:1111"), repo, limit);
    await resolveWorkspace(from("2001:db8:7:7:2222:2222:2222:2222"), repo, limit);
    await expect(resolveWorkspace(from("2001:db8:7:7:3333:3333:3333:3333"), repo, limit)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    // Another /64 is another visitor.
    await expect(resolveWorkspace(from("2001:db8:7:8:1111:1111:1111:1111"), repo, limit)).resolves.toMatchObject({ workspaceId: expect.stringMatching(/^ws_/) });
  });
});

describe("a global cap on new workspaces per hour", () => {
  const T = Date.parse("2026-10-29T04:10:00Z");

  it("admits the hourly allowance, refuses the next, and starts again the next hour", async () => {
    const repo = createMemoryRepo();
    for (let i = 0; i < 5; i++) expect(await takeGlobalWorkspaceSlot(repo, 5, T)).toBe(true);
    expect(await takeGlobalWorkspaceSlot(repo, 5, T + 60_000)).toBe(false);
    expect(await takeGlobalWorkspaceSlot(repo, 5, T + 3_600_000)).toBe(true);
  });

  it("is exact under a burst inside one isolate", async () => {
    const repo = createMemoryRepo();
    const results = await Promise.all(Array.from({ length: 30 }, () => takeGlobalWorkspaceSlot(repo, 7, T)));
    expect(results.filter(Boolean)).toHaveLength(7);
  });

  it("has a default well above one judge's use and below a flood", () => {
    expect(GLOBAL_WORKSPACES_PER_HOUR).toBeGreaterThanOrEqual(30);
    expect(GLOBAL_WORKSPACES_PER_HOUR).toBeLessThanOrEqual(120);
  });

  it("answers 429 workspace_cap to a cookie-less request once the hour is full, from any network", async () => {
    const repo = createMemoryRepo();
    const roomy = { capacity: 5, refillSeconds: 60 };
    for (let i = 0; i < GLOBAL_WORKSPACES_PER_HOUR; i++) {
      const ip = `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`;
      await resolveWorkspace(new Request("http://t.test/x", { headers: { "x-forwarded-for": ip } }), repo, roomy);
    }
    await expect(
      resolveWorkspace(new Request("http://t.test/x", { headers: { "x-forwarded-for": "192.0.2.77" } }), repo, roomy),
    ).rejects.toMatchObject({ status: 429, code: "workspace_cap" });
  });

  it("a visitor who already has a workspace is not counted or refused", async () => {
    const repo = createMemoryRepo();
    const first = await resolveWorkspace(new Request("http://t.test/x", { headers: { "x-forwarded-for": "192.0.2.1" } }), repo);
    const cookie = `le_ws=${first.workspaceId}`;
    for (let i = 0; i < 3; i++) {
      const again = await resolveWorkspace(new Request("http://t.test/x", { headers: { cookie, "x-forwarded-for": "192.0.2.1" } }), repo, { capacity: 1, refillSeconds: 3600 });
      expect(again).toEqual({ workspaceId: first.workspaceId });
    }
  });

  it("a refused per-network request does not burn a global slot (one network cannot exhaust the hour)", async () => {
    const repo = createMemoryRepo();
    const one = { capacity: 1, refillSeconds: 3600 };
    const req = () => new Request("http://t.test/x", { headers: { "x-forwarded-for": "192.0.2.9" } });
    await resolveWorkspace(req(), repo, one);
    for (let i = 0; i < 20; i++) await expect(resolveWorkspace(req(), repo, one)).rejects.toMatchObject({ code: "rate_limited" });
    let admitted = 0;
    for (let i = 0; i < GLOBAL_WORKSPACES_PER_HOUR; i++) if (await takeGlobalWorkspaceSlot(repo)) admitted++;
    expect(admitted).toBe(GLOBAL_WORKSPACES_PER_HOUR - 1);
  });
});
