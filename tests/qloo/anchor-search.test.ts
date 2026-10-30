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
  client.search = vi.fn(async (q) => ({ data: await search() as never, mode: "live" as const, at: NOW.toISOString(), path: "/search", params: q as never }));
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
      expect(r[0].name).toBe("Blue Bottle Coffee");
    }
    expect(client.search).toHaveBeenCalledTimes(1);
  });

  it("allows 3 live searches a workspace a day, then fails with qloo_budget and calls nothing (no suggested brands)", async () => {
    const repo = createMemoryRepo();
    const client = liveClient();
    const deps = { client, cache: memoryCache(), now: () => NOW };
    for (let i = 0; i < LIVE_SEARCHES_PER_WORKSPACE_PER_DAY; i++) {
      expect((await searchAnchorsGuarded(repo, "ws1", `brand ${i}`, deps)).length).toBeGreaterThan(0);
    }
    await expect(searchAnchorsGuarded(repo, "ws1", "aesop", deps)).rejects.toMatchObject({ code: "qloo_budget", status: 429 });
    expect(client.search).toHaveBeenCalledTimes(3);
    // Another workspace has its own three; the next day resets this one.
    expect((await searchAnchorsGuarded(repo, "ws2", "another", deps)).length).toBeGreaterThan(0);
    const tomorrow = { ...deps, now: () => new Date(NOW.getTime() + 24 * 3600_000) };
    expect((await searchAnchorsGuarded(repo, "ws1", "yet another", tomorrow)).length).toBeGreaterThan(0);
  });

  it("passes the app-wide ledger's refusal through as qloo_budget, never as suggestions", async () => {
    const repo = createMemoryRepo();
    const client = liveClient(async () => { throw new UpstreamError("qloo_budget", "qloo", "Live Qloo calls have used today's share.", { status: 429 }); });
    await expect(searchAnchorsGuarded(repo, "ws1", "xyz", { client, cache: memoryCache(), now: () => NOW })).rejects.toMatchObject({ code: "qloo_budget" });
  });

  it("passes a Qloo outage through as qloo_unavailable", async () => {
    const repo = createMemoryRepo();
    const client = liveClient(async () => { throw new UpstreamError("qloo_unavailable", "qloo", "down", { status: 503 }); });
    await expect(searchAnchorsGuarded(repo, "ws1", "xyz", { client, cache: memoryCache(), now: () => NOW })).rejects.toMatchObject({ code: "qloo_unavailable" });
  });

  it("replay and fixture modes are not counted against the workspace", async () => {
    const repo = createMemoryRepo();
    const client = fixtureClient();
    for (let i = 0; i < 6; i++) {
      await expect(searchAnchorsGuarded(repo, "ws1", `blue bottle ${i}`, { client, cache: memoryCache(), now: () => NOW })).resolves.toBeDefined();
    }
  });
});
