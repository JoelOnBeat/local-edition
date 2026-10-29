import { describe, expect, it } from "vitest";
import { sampleSeed } from "@/server/sample/chain";
import { NotFoundError, VersionConflictError, WorkspaceExistsError, type SeedWithId, type Repo } from "@/server/store";
import { createMemoryRepo } from "@/server/store/memory";
import { cardFor, cleanEdition, fakeKvNamespace, makeRepo, type Driver } from "./helpers";
import { CloudflareKv } from "@/server/store/kv";
import { KeyedRepo } from "@/server/store";

const drivers: Driver[] = ["memory", "file", "kv"];

describe.each(drivers)("T1 repo contract: %s driver", (driver) => {
  const fresh = () => makeRepo(driver);
  const seeded = async (repo: Repo, id?: string) => repo.createWorkspace({ ...sampleSeed(), workspaceId: id } as SeedWithId);

  it("creates a workspace with its chain, stores and menu, and rejects a duplicate id", async () => {
    const repo = await fresh();
    const ws = await seeded(repo, "ws_alpha");
    expect(ws).toMatchObject({ id: "ws_alpha", chainId: "chain_kettle_kiln" });
    expect(await repo.getWorkspace("ws_alpha")).toEqual(ws);
    expect((await repo.getChain(ws.chainId))?.name).toContain("Kettle & Kiln");
    expect(await repo.listStores(ws.chainId)).toHaveLength(8);
    expect(await repo.listMenu(ws.chainId)).toHaveLength(22);
    expect((await repo.listWorkspaces()).map((w) => w.id)).toEqual(["ws_alpha"]);
    await expect(seeded(repo, "ws_alpha")).rejects.toBeInstanceOf(WorkspaceExistsError);
    expect(await repo.getWorkspace("nope")).toBeNull();
  });

  it("never hands out shared references: mutating a returned row does not change storage", async () => {
    const repo = await fresh();
    const ws = await seeded(repo);
    const chain = (await repo.getChain(ws.chainId))!;
    chain.name = "Tampered";
    expect((await repo.getChain(ws.chainId))!.name).not.toBe("Tampered");
  });

  it("puts, replaces and deletes stores along with their editions and cards", async () => {
    const repo = await fresh();
    const ws = await seeded(repo);
    const edition = cleanEdition();
    await repo.putEdition(edition);
    await repo.putStaffCard(cardFor(edition));
    await repo.cachePut("qloo:profile:v1:store_williamsburg:abc", { x: 1 }, 600);
    await repo.cachePut("anchors:coffee", { x: 2 }, 600);
    expect(await repo.deleteStore("store_williamsburg")).toBe(true);
    expect(await repo.getStore("store_williamsburg")).toBeNull();
    expect(await repo.listStores(ws.chainId)).toHaveLength(7);
    expect(await repo.getEdition(edition.id)).toBeNull();
    expect(await repo.getEditionForWeek("store_williamsburg", edition.weekOf)).toBeNull();
    expect(await repo.getStaffCardByToken("tok_test_card_0001")).toBeNull();
    expect(await repo.cacheGet("qloo:profile:v1:store_williamsburg:abc")).toBeNull();
    expect(await repo.cacheGet("anchors:coffee")).toEqual({ x: 2 });
    expect(await repo.deleteStore("store_williamsburg")).toBe(false);
  });

  it("replaces a menu wholesale", async () => {
    const repo = await fresh();
    const ws = await seeded(repo);
    const first = (await repo.listMenu(ws.chainId)).slice(0, 2);
    await repo.replaceMenu(ws.chainId, first);
    expect(await repo.listMenu(ws.chainId)).toEqual(first);
  });

  it("indexes editions by store and week and returns the newest per store", async () => {
    const repo = await fresh();
    await seeded(repo);
    const older = { ...cleanEdition(), id: "ed_old", weekOf: "2026-10-19" };
    const newer = { ...cleanEdition(), id: "ed_new", weekOf: "2026-10-26" };
    const other = { ...cleanEdition("store_astoria", "ed_astoria") };
    for (const e of [older, newer, other]) await repo.putEdition(e);
    expect((await repo.getEditionForWeek("store_williamsburg", "2026-10-19"))?.id).toBe("ed_old");
    const latest = await repo.listEditions({ storeIds: ["store_williamsburg", "store_astoria", "store_harlem"] });
    expect(latest.map((e) => e.id).sort()).toEqual(["ed_astoria", "ed_new"]);
    const week = await repo.listEditions({ storeIds: ["store_williamsburg"], weekOf: "2026-10-19" });
    expect(week.map((e) => e.id)).toEqual(["ed_old"]);
    expect(await repo.listEditions({ storeIds: [] })).toEqual([]);
  });

  it("checks item versions: bumps on success, throws VersionConflictError on a stale write", async () => {
    const repo = await fresh();
    const edition = cleanEdition();
    await repo.putEdition(edition);
    const item = edition.items[0];
    const stored = await repo.updateEditionItem(edition.id, { ...item, status: "approved" }, 0);
    expect(stored).toMatchObject({ status: "approved", version: 1 });
    expect((await repo.getEdition(edition.id))!.items[0].version).toBe(1);
    await expect(repo.updateEditionItem(edition.id, { ...item, status: "rejected" }, 0)).rejects.toBeInstanceOf(VersionConflictError);
    await expect(repo.updateEditionItem(edition.id, { ...item, id: "ghost" }, 0)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.updateEditionItem("ed_missing", item, 0)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets exactly one of two concurrent writers at the same version win", async () => {
    const repo = await fresh();
    const edition = cleanEdition();
    await repo.putEdition(edition);
    const item = edition.items[1];
    const results = await Promise.allSettled([
      repo.updateEditionItem(edition.id, { ...item, status: "approved" }, 0),
      repo.updateEditionItem(edition.id, { ...item, status: "rejected" }, 0),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(VersionConflictError) });
    expect((await repo.getEdition(edition.id))!.items[1].version).toBe(1);
  });

  it("sets edition status and reports a missing edition", async () => {
    const repo = await fresh();
    const edition = cleanEdition();
    await repo.putEdition(edition);
    expect((await repo.setEditionStatus(edition.id, "approved")).status).toBe("approved");
    await expect(repo.setEditionStatus("ed_missing", "draft")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps evidence, staff cards (by edition and token) and job runs", async () => {
    const repo = await fresh();
    const edition = cleanEdition();
    await repo.putEdition(edition);
    await repo.putEvidence(edition.evidence);
    expect((await repo.getEvidence([edition.evidence[1].id, "ev_nope", edition.evidence[0].id])).map((e) => e.id)).toEqual([edition.evidence[1].id, edition.evidence[0].id]);

    await repo.putStaffCard(cardFor(edition, "tok_first_0000000001"));
    await repo.putStaffCard(cardFor(edition, "tok_second_000000001"));
    expect(await repo.getStaffCardByToken("tok_first_0000000001")).toBeNull();
    expect((await repo.getStaffCardByToken("tok_second_000000001"))?.editionId).toBe(edition.id);
    expect((await repo.getStaffCardByEdition(edition.id))?.token).toBe("tok_second_000000001");

    expect(await repo.latestJobRun()).toBeNull();
    const base = { trigger: "cron" as const, finishedAt: null, storeIds: [], status: "running" as const, nebiusJobId: null, note: "" };
    await repo.putJobRun({ ...base, id: "job_1", startedAt: "2026-10-26T00:00:00.000Z" });
    await repo.putJobRun({ ...base, id: "job_2", startedAt: "2026-10-27T00:00:00.000Z" });
    await repo.putJobRun({ ...base, id: "job_1", startedAt: "2026-10-26T00:00:00.000Z", status: "done" });
    expect((await repo.latestJobRun())?.id).toBe("job_2");
    expect((await repo.getJobRun("job_1"))?.status).toBe("done");
  });
});

describe("T2 cache TTL", () => {
  it("expires cache entries (memory) and clamps to Workers KV's 60 s minimum (kv)", async () => {
    let t = 1_000_000;
    const mem = createMemoryRepo(() => t);
    await mem.cachePut("k", { v: 1 }, 30);
    expect(await mem.cacheGet("k")).toEqual({ v: 1 });
    t += 31_000;
    expect(await mem.cacheGet("k")).toBeNull();

    const ns = fakeKvNamespace();
    const kv = new KeyedRepo(new CloudflareKv(async () => ns));
    await kv.cachePut("k", 1, 5);
    expect(ns.ttls).toEqual([60]);
  });
});

describe("T2 file driver", () => {
  it("survives a restart: a second repo on the same file sees the first one's writes", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createFileRepo } = await import("@/server/store/file");
    const file = join(await mkdtemp(join(tmpdir(), "le-file-")), "nested", "store.json");
    const a = createFileRepo(file);
    await a.createWorkspace({ ...sampleSeed(), workspaceId: "ws_persist" } as SeedWithId);
    const b = createFileRepo(file);
    expect((await b.getWorkspace("ws_persist"))?.id).toBe("ws_persist");
    expect(await b.listStores("chain_kettle_kiln")).toHaveLength(8);
    await b.deleteStore("store_harlem");
    expect(await a.getStore("store_harlem")).toBeNull();
  });
});
