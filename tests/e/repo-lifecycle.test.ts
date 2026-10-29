import { describe, expect, it } from "vitest";
import type { Edition } from "@/contract";
import { sampleSeed } from "@/server/sample/chain";
import { NotFoundError, type Repo, type SeedWithId } from "@/server/store";
import { createMemoryRepo } from "@/server/store/memory";
import { cardFor, cleanEdition, makeRepo, type Driver } from "./helpers";

/** Repo additions for the review fixes, run against every driver: version-checked edition writes, locks, set-if-absent cards. */

const drivers: Driver[] = ["memory", "file", "kv"];

describe.each(drivers)("repo lifecycle: %s driver", (driver) => {
  const setup = async () => {
    const repo = await makeRepo(driver);
    await repo.createWorkspace({ ...sampleSeed(), workspaceId: "ws_alpha" } as SeedWithId);
    return repo;
  };

  describe("updateEdition", () => {
    it("hands the mutator the stored row, keeps id, storeId and weekOf, and writes the result", async () => {
      const repo = await setup();
      const e = cleanEdition();
      await repo.putEdition(e);
      const out = await repo.updateEdition(e.id, (cur) => ({ ...cur, id: "ed_other", storeId: "store_other", weekOf: "1999-01-04", status: "flagged" }));
      expect(out).toMatchObject({ id: e.id, storeId: e.storeId, weekOf: e.weekOf, status: "flagged" });
      expect((await repo.getEdition(e.id))!.status).toBe("flagged");
      expect((await repo.getEditionForWeek(e.storeId, e.weekOf))!.id).toBe(e.id);
    });

    it("applies simultaneous updates one after another, so neither overwrites the other", async () => {
      const repo = await setup();
      const e = cleanEdition();
      await repo.putEdition(e);
      const add = (n: number) => repo.updateEdition(e.id, (cur) => ({ ...cur, evidence: [...cur.evidence, { ...cur.evidence[0], id: `ev_extra_${n}` }] }));
      await Promise.all([add(1), add(2), add(3)]);
      const ids = (await repo.getEdition(e.id))!.evidence.map((x) => x.id);
      expect(ids).toEqual(expect.arrayContaining(["ev_extra_1", "ev_extra_2", "ev_extra_3"]));
    });

    it("does not overwrite an item write that happened meanwhile (the mutator sees the newer row)", async () => {
      const repo = await setup();
      const e = cleanEdition();
      await repo.putEdition(e);
      await repo.updateEditionItem(e.id, { ...e.items[0], status: "approved" }, 0);
      const out = await repo.updateEdition(e.id, (cur) => ({ ...cur, status: "draft" }));
      expect(out.items[0]).toMatchObject({ status: "approved", version: 1 });
    });

    it("leaves the row alone when the mutator throws, and throws NotFoundError for a missing edition", async () => {
      const repo = await setup();
      const e = cleanEdition();
      await repo.putEdition(e);
      await expect(repo.updateEdition(e.id, () => { throw new Error("abort"); })).rejects.toThrow("abort");
      expect(await repo.getEdition(e.id)).toEqual(e);
      await expect(repo.updateEdition("ed_missing", (c) => c)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("listEditions({ finishedOnly }) returns the newest edition that is not drafting", async () => {
    const repo = await setup();
    const base = cleanEdition();
    const make = (id: string, weekOf: string, status: Edition["status"]): Edition => ({ ...base, id, weekOf, status });
    await repo.putEdition(make("ed_w1", "2026-10-19", "approved"));
    await repo.putEdition(make("ed_w2", "2026-10-26", "draft"));
    await repo.putEdition(make("ed_w3", "2026-11-02", "drafting"));
    const q = { storeIds: [base.storeId] };
    expect((await repo.listEditions(q)).map((e) => e.id)).toEqual(["ed_w3"]);
    expect((await repo.listEditions({ ...q, finishedOnly: true })).map((e) => e.id)).toEqual(["ed_w2"]);
    expect(await repo.listEditions({ ...q, finishedOnly: true, weekOf: "2026-11-02" })).toEqual([]);
  });

  it("putStaffCardIfAbsent stores the first card and returns it to every later caller", async () => {
    const repo = await setup();
    const e = cleanEdition();
    await repo.putEdition(e);
    const [x, y] = await Promise.all([repo.putStaffCardIfAbsent(cardFor(e, "tok_first_0000000001")), repo.putStaffCardIfAbsent(cardFor(e, "tok_second_000000002"))]);
    expect(x.token).toBe(y.token);
    expect((await repo.getStaffCardByEdition(e.id))!.token).toBe(x.token);
    expect((await repo.getStaffCardByToken(x.token))!.editionId).toBe(e.id);
    const loser = x.token === "tok_first_0000000001" ? "tok_second_000000002" : "tok_first_0000000001";
    expect(await repo.getStaffCardByToken(loser)).toBeNull(); // no token handed out that does not resolve
  });

  it("locks: one holder at a time, a wrong token cannot release, and release frees it", async () => {
    const repo = await setup();
    const token = await repo.acquireLock("build:ws_alpha", 600);
    expect(token).toBeTruthy();
    expect(await repo.acquireLock("build:ws_alpha", 600)).toBeNull();
    expect(await repo.acquireLock("build:ws_beta", 600)).toBeTruthy(); // another name is independent
    await repo.releaseLock("build:ws_alpha", "not-the-token");
    expect(await repo.acquireLock("build:ws_alpha", 600)).toBeNull();
    await repo.releaseLock("build:ws_alpha", token!);
    expect(await repo.acquireLock("build:ws_alpha", 600)).toBeTruthy();
  });

  it("concurrent acquires: exactly one wins", async () => {
    const repo = await setup();
    const got = await Promise.all(Array.from({ length: 6 }, () => repo.acquireLock("race", 600)));
    expect(got.filter(Boolean)).toHaveLength(1);
  });
});

describe("lock expiry", () => {
  it("a lock held by a dead build frees itself after its TTL", async () => {
    let now = Date.now();
    const repo: Repo = createMemoryRepo(() => now);
    expect(await repo.acquireLock("build:ws_x", 600)).toBeTruthy();
    now += 599_000;
    expect(await repo.acquireLock("build:ws_x", 600)).toBeNull();
    now += 2_000;
    expect(await repo.acquireLock("build:ws_x", 600)).toBeTruthy();
  });
});
