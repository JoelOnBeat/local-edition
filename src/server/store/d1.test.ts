import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Repo } from "./repo";
import { createD1Repo } from "./d1";
import { KvCache } from "./d1-cache";
import { MemoryKv } from "./memory";
import { openTestD1, wipe } from "./d1-test-utils";
import type { D1Like } from "../platform/types";
import { cardFor, cleanEdition } from "../../../tests/e/helpers";
import { sampleSeed } from "@/server/sample/chain";
import type { SeedWithId } from "./keyed-repo";

/**
 * The D1 driver runs the repo's existing contract suites unchanged: `tests/e/repo.test.ts` and
 * `tests/e/repo-lifecycle.test.ts` loop over `makeRepo(driver)`, and this file replaces `makeRepo` so every
 * loop iteration gets a fresh D1 repo. Below them: what only D1 adds (workspace_id, TTL purge, cache backends).
 */

const state: { db?: D1Like; dispose?: () => Promise<void>; now: number } = { now: Date.UTC(2026, 9, 29, 12) };
const open = async (): Promise<D1Like> => {
  if (!state.db) Object.assign(state, await openTestD1());
  await wipe(state.db!);
  return state.db!;
};

vi.mock("../../../tests/e/helpers", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../tests/e/helpers")>();
  return {
    ...original,
    makeRepo: async (): Promise<Repo> => {
      const db = await open();
      return createD1Repo(async () => db);
    },
  };
});

await import("../../../tests/e/repo.test");
await import("../../../tests/e/repo-lifecycle.test");

afterAll(async () => { await state.dispose?.(); });

describe("D1 specifics", () => {
  beforeAll(open);
  const fresh = async (cache?: ConstructorParameters<typeof Object>[0]) => {
    const db = await open();
    return { db, repo: createD1Repo(async () => db, { now: () => state.now, cache: cache as never }) };
  };
  const first = async (db: D1Like, sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).first<Record<string, unknown>>();

  it("stamps workspace_id on every row that belongs to a workspace", async () => {
    const { db, repo } = await fresh();
    await repo.createWorkspace({ ...sampleSeed(), workspaceId: "ws_owner" } as SeedWithId);
    const edition = cleanEdition();
    await repo.putEdition(edition);
    await repo.putStaffCard(cardFor(edition));
    for (const table of ["chains", "stores", "menus", "editions", "staff_cards"]) {
      const bad = await first(db, `SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id <> 'ws_owner'`);
      expect(bad, table).toMatchObject({ n: 0 });
    }
  });

  it("applies a seed atomically: a duplicate workspace id leaves nothing half-written", async () => {
    const { db, repo } = await fresh();
    await repo.createWorkspace({ ...sampleSeed(), workspaceId: "ws_once" } as SeedWithId);
    const other = sampleSeed();
    await expect(repo.createWorkspace({ ...other, stores: other.stores.slice(0, 1), workspaceId: "ws_once" } as SeedWithId)).rejects.toThrow(/already exists/);
    expect(await first(db, "SELECT COUNT(*) AS n FROM stores")).toMatchObject({ n: 8 });
  });

  it("treats a lock as held until its TTL passes, then lets another caller take it", async () => {
    let t = state.now;
    const db = await open();
    const repo = createD1Repo(async () => db, { now: () => t });
    const token = await repo.acquireLock("build:ws_a", 60);
    expect(token).toBeTruthy();
    expect(await repo.acquireLock("build:ws_a", 60)).toBeNull();
    await repo.releaseLock("build:ws_a", "wrong-token");
    expect(await repo.acquireLock("build:ws_a", 60)).toBeNull();
    t += 61_000;
    expect(await repo.acquireLock("build:ws_a", 60)).toBeTruthy();
  });

  it("serialises a hundred concurrent lock attempts into exactly one winner", async () => {
    const { repo } = await fresh();
    const results = await Promise.all(Array.from({ length: 100 }, () => repo.acquireLock("build:ws_race", 60)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("expires a visitor workspace and purgeExpired removes it with everything under it, keeping the demo", async () => {
    let t = state.now;
    const db = await open();
    const repo = createD1Repo(async () => db, { now: () => t });
    await repo.createWorkspace({ ...sampleSeed(), workspaceId: "demo" } as SeedWithId);
    const visitor = sampleSeed();
    await repo.createWorkspace({ ...visitor, chain: { ...visitor.chain, id: "chain_v" }, stores: visitor.stores.map((s) => ({ ...s, id: `${s.id}~v`, chainId: "chain_v" })), workspaceId: "ws_visitor" } as SeedWithId);
    await repo.putEdition({ ...cleanEdition("store_williamsburg", "ed_visitor"), storeId: "store_williamsburg~v" });
    await repo.putEvidence(cleanEdition().evidence);
    expect(await repo.getWorkspace("ws_visitor")).not.toBeNull();
    t += 32 * 24 * 3600 * 1000;
    expect(await repo.getWorkspace("ws_visitor")).toBeNull();
    expect(await repo.getWorkspace("demo")).not.toBeNull();
    expect(await repo.purgeExpired()).toBe(1);
    expect(await first(db, "SELECT COUNT(*) AS n FROM editions WHERE workspace_id = 'ws_visitor'")).toMatchObject({ n: 0 });
    expect(await first(db, "SELECT COUNT(*) AS n FROM stores WHERE workspace_id = 'ws_visitor'")).toMatchObject({ n: 0 });
    expect(await first(db, "SELECT COUNT(*) AS n FROM stores WHERE workspace_id = 'demo'")).toMatchObject({ n: 8 });
    expect(await first(db, "SELECT COUNT(*) AS n FROM evidence")).toMatchObject({ n: 0 });
  });

  it("keeps a compare-and-swap write exact across two repos on the same database", async () => {
    const db = await open();
    const a = createD1Repo(async () => db);
    const b = createD1Repo(async () => db);
    const edition = cleanEdition();
    await a.putEdition(edition);
    const bump = (repo: Repo, n: number) => repo.updateEdition(edition.id, (cur) => ({ ...cur, evidence: [...cur.evidence, { ...cur.evidence[0], id: `ev_x_${n}` }] }));
    await Promise.all([bump(a, 1), bump(b, 2), bump(a, 3), bump(b, 4)]);
    const ids = (await a.getEdition(edition.id))!.evidence.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["ev_x_1", "ev_x_2", "ev_x_3", "ev_x_4"]));
  });

  it("serves the provider cache from KV when a namespace is bound, and purges a deleted store's entries there", async () => {
    const kv = new MemoryKv();
    const { repo } = await fresh(new KvCache(kv));
    await repo.createWorkspace({ ...sampleSeed(), workspaceId: "ws_kvc" } as SeedWithId);
    await repo.cachePut("qloo:profile:v1:store_astoria:h", { profile: { evidenceIds: [] } }, 600);
    await repo.cachePut("anchors:coffee", { n: 1 }, 600);
    expect(await kv.get("cache:anchors:coffee")).toEqual({ n: 1 });
    expect(await repo.deleteStore("store_astoria")).toBe(true);
    expect(await repo.cacheGet("qloo:profile:v1:store_astoria:h")).toBeNull();
    expect(await repo.cacheGet("anchors:coffee")).toEqual({ n: 1 });
  });

  it("does not treat `_` in a store id as a wildcard when purging caches", async () => {
    const { repo } = await fresh();
    await repo.createWorkspace({ ...sampleSeed(), workspaceId: "ws_wild" } as SeedWithId);
    await repo.cachePut("qloo:profile:v1:storeXharlem:h", { keep: true }, 600);
    await repo.deleteStore("store_harlem");
    expect(await repo.cacheGet("qloo:profile:v1:storeXharlem:h")).toEqual({ keep: true });
  });
});
