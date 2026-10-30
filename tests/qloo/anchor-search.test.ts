import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/server/http/errors";
import { searchAnchorsGuarded, LIVE_SEARCHES_PER_WORKSPACE_PER_DAY } from "@/server/qloo/anchor-search";
import { memoryCache } from "@/server/qloo/deps";
import { createMemoryRepo } from "@/server/store/memory";
import { fixtureClient, NOW } from "./helpers";

const brand = (n: string) => ({ success: true, results: { entities: [{ entity_id: crypto.randomUUID(), name: n, subtype: "urn:entity:brand" }] } });
const liveClient = (search = async (): Promise<unknown> => brand("Blue Bottle Coffee")) => {
  const client = fixtureClient();
  Object.assign(client, { mode: "live" });
  client.search = vi.fn(async (q) => ({ data: await search() as never, mode: "live" as const, path: "/search", params: q as never }));
  return client;
};

describe("anchor search spends Qloo credits carefully", () => {
  it("serves a saved answer without any call, even when live searches are used up", async () => {
    const repo = createMemoryRepo();
    const client = liveClient();
    const cache = memoryCache();
    await searchAnchorsGuarded(repo, "ws1", "blue bottle", { client, cache, now: () => NOW });
    for (let i = 0; i < 5; i++) {
      const r = await searchAnchorsGuarded(repo, "ws1", "Blue Bottle", { client, cache, now: () => NOW });
      expect(r.code).toBeNull();
      expect(r.refs[0].name).toBe("Blue Bottle Coffee");
    }
    expect(client.search).toHaveBeenCalledTimes(1);
  });

  it("allows 3 live searches a workspace a day, then suggests brands with code qloo_budget and calls nothing", async () => {
    const repo = createMemoryRepo();
    const client = liveClient();
    const deps = { client, cache: memoryCache(), now: () => NOW };
    for (let i = 0; i < LIVE_SEARCHES_PER_WORKSPACE_PER_DAY; i++) {
      expect((await searchAnchorsGuarded(repo, "ws1", `brand ${i}`, deps)).code).toBeNull();
    }
    const over = await searchAnchorsGuarded(repo, "ws1", "aesop", deps);
    expect(over.code).toBe("qloo_budget");
    expect(over.refs.map((r) => r.name)).toContain("Aesop");
    expect(client.search).toHaveBeenCalledTimes(3);
    // Another workspace has its own three; the next day resets this one.
    expect((await searchAnchorsGuarded(repo, "ws2", "another", deps)).code).toBeNull();
    const tomorrow = { ...deps, now: () => new Date(NOW.getTime() + 24 * 3600_000) };
    expect((await searchAnchorsGuarded(repo, "ws1", "yet another", tomorrow)).code).toBeNull();
  });

  it("falls back to suggestions when the app-wide ledger refuses", async () => {
    const repo = createMemoryRepo();
    const client = liveClient(async () => { throw new UpstreamError("spend_cap", "qloo", "Live Qloo calls have used today's share.", { status: 429 }); });
    const r = await searchAnchorsGuarded(repo, "ws1", "xyz", { client, cache: memoryCache(), now: () => NOW });
    expect(r.code).toBe("qloo_budget");
    expect(r.refs.length).toBeGreaterThan(0);
  });

  it("replay and fixture modes are not counted against the workspace", async () => {
    const repo = createMemoryRepo();
    const client = fixtureClient();
    for (let i = 0; i < 6; i++) {
      expect((await searchAnchorsGuarded(repo, "ws1", `blue bottle ${i}`, { client, cache: memoryCache(), now: () => NOW })).code).toBeNull();
    }
  });
});
