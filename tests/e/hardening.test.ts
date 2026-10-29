import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Evidence } from "@/contract";
import { createStore, deleteStore, getWorkspace, importStores } from "@/server/handlers/workspace";
import { dedupeStores } from "@/server/handlers/csv";
import { createVisitorWorkspace, ensureDemoWorkspace, readCookie, resolveWorkspace } from "@/server/session";
import { VISITOR_TTL_SECONDS, isVisitorId } from "@/server/store/ids";
import { FileKv } from "@/server/store/file";
import { KeyedRepo } from "@/server/store";
import { MemoryKv } from "@/server/store/memory";
import type { Repo } from "@/server/store";
import { cleanEdition, cookieOf, freshApp, req } from "./helpers";

/** The LOW items of the data-path review that live in stream E's files. */

const csv = (rows: string[][]) => ["name,address,lat,lon", ...rows.map((r) => r.join(","))].join("\n");
const post = (cookie: string, body: string) => importStores(req("/api/stores/import", { cookie, method: "POST", headers: { "content-type": "text/csv" }, body }));
let repo: Repo;
beforeEach(() => { repo = freshApp(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("session cookie", () => {
  it("treats a malformed %-sequence as no cookie instead of throwing", () => {
    expect(readCookie(req("/", { cookie: "le_ws=%E0%A4%A" }), "le_ws")).toBeNull();
    expect(readCookie(req("/", { cookie: "other=1; le_ws=%" }), "le_ws")).toBeNull();
    expect(readCookie(req("/", { cookie: "le_ws=ws_ok%7E1" }), "le_ws")).toBe("ws_ok~1");
  });

  it("gives a browser with a corrupt cookie a fresh workspace, not a 500", async () => {
    const res = await getWorkspace(req("/api/workspace", { cookie: "le_ws=%E0%A4%A", ip: "10.7.0.1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^le_ws=ws_/);
  });

  it("forces Secure in production even when the request looks like plain http", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await getWorkspace(req("/api/workspace", { ip: "10.7.0.2" }));
    expect(res.headers.get("set-cookie")).toContain("Secure");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("does not trust x-forwarded-for to dodge the new-workspace limit in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const limit = { capacity: 2, refillSeconds: 3600 };
    const spoof = (n: number) => new Request("http://localhost/x", { headers: { "x-forwarded-for": `1.2.3.${n}` } });
    await resolveWorkspace(spoof(1), repo, limit);
    await resolveWorkspace(spoof(2), repo, limit);
    await expect(resolveWorkspace(spoof(3), repo, limit)).rejects.toMatchObject({ status: 429 });
  });
});

describe("visitor rows expire, and there is no hot workspace index", () => {
  class SpyKv extends MemoryKv {
    ttl = new Map<string, number | undefined>();
    override async put(key: string, value: unknown, opts?: { ttlSeconds?: number }) {
      this.ttl.set(key, opts?.ttlSeconds);
      return super.put(key, value, opts);
    }
  }

  it("writes no idx:ws key, and gives visitor rows a TTL but the demo workspace none", async () => {
    const kv = new SpyKv();
    const r = new KeyedRepo(kv);
    await ensureDemoWorkspace(r);
    const demoKeys = [...kv.ttl.keys()];
    expect(demoKeys.length).toBeGreaterThan(10);
    expect(demoKeys.every((k) => kv.ttl.get(k) === undefined)).toBe(true);

    kv.ttl.clear();
    const ws = await createVisitorWorkspace(r);
    expect([...kv.ttl.keys()].some((k) => k.startsWith("idx:"))).toBe(false);
    expect(await kv.list("idx:")).toEqual([]);
    for (const key of kv.ttl.keys()) expect(kv.ttl.get(key), key).toBeGreaterThanOrEqual(VISITOR_TTL_SECONDS - 3600);
    // The workspace row goes first, so nothing is reachable through a half-expired set of rows.
    expect(kv.ttl.get(`ws:${ws.id}`)).toBeLessThan(kv.ttl.get(`chain:${ws.chainId}`)!);
    expect(kv.ttl.get(`ws:${ws.id}`)).toBeGreaterThan(30 * 24 * 3600); // outlives the 30-day cookie
  });

  it("still lists workspaces by scanning their keys, and lets an expired visitor vanish", async () => {
    let now = Date.now();
    const r = new KeyedRepo(new MemoryKv(() => now));
    await ensureDemoWorkspace(r);
    const ws = await createVisitorWorkspace(r);
    expect((await r.listWorkspaces()).map((w) => w.id).sort()).toEqual(["demo", ws.id].sort());
    now += (VISITOR_TTL_SECONDS + 10) * 1000;
    expect((await r.listWorkspaces()).map((w) => w.id)).toEqual(["demo"]);
    expect(await r.getChain(ws.chainId)).toBeNull();
  });

  it("gives a store a visitor adds the workspace's suffix, so its row expires with the workspace", async () => {
    const res = await getWorkspace(req("/api/workspace", { ip: "10.7.1.1" }));
    const cookie = cookieOf(res);
    const created = await createStore(req("/api/stores", { cookie, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Greenpoint", addressLabel: "Manhattan Ave & Java St", lat: 40.7295, lon: -73.9544 }) }));
    const store = await created.json();
    expect(isVisitorId(store.id)).toBe(true);
    expect(store.id).toMatch(/^store_[0-9a-z]+~[0-9a-z]+$/);
  });
});

describe("deleteStore purges exactly what belongs to the store", () => {
  const evidence = (id: string): Evidence => ({ id, source: "qloo", endpoint: "/v2/insights", params: {}, summary: "x", metrics: {}, entityIds: [], fetchedAt: "2026-10-26T00:00:00.000Z", mode: "fixture" });

  it("removes its profile and compare caches and the evidence they referenced, and nothing for a store with a longer id", async () => {
    const seed = await repo.createWorkspace({ ...(await import("@/server/sample/chain")).sampleSeed(), workspaceId: "ws_purge" } as never);
    const [first] = await repo.listStores(seed.chainId);
    const id = first.id;
    const longer = { ...first, id: `${id}x` };
    await repo.putStore(longer);
    await repo.putEvidence([evidence("ev_mine"), evidence("ev_theirs"), evidence("ev_unrelated")]);
    await repo.cachePut(`qloo:profile:v1:${id}:sig1`, { profile: { evidenceIds: ["ev_mine"] }, evidence: [{ id: "ev_mine" }] }, 600);
    await repo.cachePut(`qloo:profile:v1:${longer.id}:sig1`, { profile: { evidenceIds: ["ev_theirs"] }, evidence: [] }, 600);
    await repo.cachePut(`qloo:compare:v1:${[id, "store_zzz"].sort().join(":")}`, { shared: [] }, 600);
    await repo.cachePut(`qloo:compare:v1:${[longer.id, "store_zzz"].sort().join(":")}`, { shared: [] }, 600);
    await repo.cachePut("qloo:baseline:v1:new-york:places", { x: 1 }, 600);

    expect(await repo.deleteStore(id)).toBe(true);
    expect(await repo.cacheGet(`qloo:profile:v1:${id}:sig1`)).toBeNull();
    expect(await repo.cacheGet(`qloo:compare:v1:${[id, "store_zzz"].sort().join(":")}`)).toBeNull();
    expect((await repo.getEvidence(["ev_mine"]))).toEqual([]);
    // Substring matches would have taken these too.
    expect(await repo.cacheGet(`qloo:profile:v1:${longer.id}:sig1`)).not.toBeNull();
    expect(await repo.cacheGet(`qloo:compare:v1:${[longer.id, "store_zzz"].sort().join(":")}`)).not.toBeNull();
    expect((await repo.getEvidence(["ev_theirs", "ev_unrelated"])).map((e) => e.id)).toEqual(["ev_theirs", "ev_unrelated"]);
    expect(await repo.cacheGet("qloo:baseline:v1:new-york:places")).toEqual({ x: 1 });
  });

  it("deletes through the route and keeps a store it does not own", async () => {
    const res = await getWorkspace(req("/api/workspace", { ip: "10.7.2.1" }));
    const body = await res.clone().json();
    const target = body.stores[0].id;
    expect((await deleteStore(req("/x", { cookie: cookieOf(res), method: "DELETE" }), { params: Promise.resolve({ id: target }) })).status).toBe(200);
    expect((await deleteStore(req("/x", { ip: "10.7.2.2", method: "DELETE" }), { params: Promise.resolve({ id: body.stores[1].id }) })).status).toBe(404);
    expect(await repo.getStore(body.stores[1].id)).not.toBeNull();
    expect(cleanEdition().id).toBeTruthy();
  });
});

describe("file driver does not lose a write when reads and writes interleave", () => {
  it("keeps every key from 60 concurrent puts mixed with reads, as a fresh process sees them", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "le-race-")), "store.json");
    const kv = new FileKv(file);
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 60; i++) {
      work.push(kv.put(`row:${i}`, { i }));
      work.push(kv.get(`row:${(i * 7) % 60}`));
      if (i % 5 === 0) work.push(kv.list("row:"));
    }
    await Promise.all(work);
    const fresh = new FileKv(file);
    expect((await fresh.list("row:")).length).toBe(60);
    for (let i = 0; i < 60; i++) expect(await fresh.get(`row:${i}`)).toEqual({ i });
  });

  it("keeps a write made while another process's newer snapshot is being loaded", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "le-race2-")), "store.json");
    const a = new FileKv(file);
    const b = new FileKv(file);
    await a.put("from:a", 1);
    await Promise.all([b.put("from:b", 2), b.get("from:a"), a.get("from:b")]);
    const fresh = new FileKv(file);
    expect(await fresh.get("from:b")).toBe(2);
    expect(await fresh.get("from:a")).toBe(1);
  });
});

describe("CSV import is safe to repeat", () => {
  const rows = [["Greenpoint", "Manhattan Ave & Java St", "40.7295", "-73.9544"], ["Bushwick", "Knickerbocker Ave & Troutman St", "40.7036", "-73.9206"]];

  it("importing the same sheet twice adds the stores once", async () => {
    const cookie = cookieOf(await getWorkspace(req("/api/workspace", { ip: "10.7.3.1" })));
    const first = await post(cookie, csv(rows));
    expect((await first.json()).map((s: { name: string }) => s.name)).toEqual(["Greenpoint", "Bushwick"]);
    const second = await post(cookie, csv(rows));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual([]);
    const bundle = await (await getWorkspace(req("/api/workspace", { cookie }))).json();
    expect(bundle.stores).toHaveLength(10);
  });

  it("matches name and address ignoring case and spacing, and only adds the new row of a mixed sheet", async () => {
    const cookie = cookieOf(await getWorkspace(req("/api/workspace", { ip: "10.7.3.2" })));
    await post(cookie, csv(rows));
    const mixed = await post(cookie, csv([["  greenpoint ", "MANHATTAN  AVE & JAVA ST", "40.7295", "-73.9544"], ["Red Hook", "Van Brunt St & Pioneer St", "40.6761", "-74.0121"]]));
    expect((await mixed.json()).map((s: { name: string }) => s.name)).toEqual(["Red Hook"]);
  });

  it("drops a repeated row inside one file, keeps the same name at a different address, and checks the 50-store cap after de-duplicating", async () => {
    const stores = [{ name: "A", addressLabel: "1 Main St", lat: 1, lon: 1 }, { name: "A", addressLabel: "1 Main St", lat: 1, lon: 1 }, { name: "A", addressLabel: "2 Main St", lat: 1, lon: 1 }];
    expect(dedupeStores(stores, []).map((s) => s.addressLabel)).toEqual(["1 Main St", "2 Main St"]);
    const cookie = cookieOf(await getWorkspace(req("/api/workspace", { ip: "10.7.3.3" })));
    const sample = (await (await getWorkspace(req("/api/workspace", { cookie }))).json()).stores as { name: string; addressLabel: string; lat: number; lon: number }[];
    const again = await post(cookie, csv(sample.map((s) => [s.name, s.addressLabel, String(s.lat), String(s.lon)])));
    expect(again.status).toBe(200); // all eight already exist: nothing to add, so no store_limit
    expect(await again.json()).toEqual([]);
  });
});
