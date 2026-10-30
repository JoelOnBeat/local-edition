import { afterAll, describe, expect, it } from "vitest";
import { EmailTakenError, type AuthStore, type UserRow } from "@/server/auth";
import { D1AuthStore } from "@/server/auth/store-d1";
import { KvAuthStore } from "@/server/auth/store-kv";
import { openTestD1 } from "@/server/store/d1-test-utils";
import { MemoryKv } from "@/server/store/memory";
import { makeRepo } from "../e/helpers";

const disposers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const d of disposers) await d(); });

const stores: Record<string, () => Promise<AuthStore>> = {
  kv: async () => new KvAuthStore(new MemoryKv()),
  d1: async () => {
    const t = await openTestD1();
    disposers.push(t.dispose);
    return new D1AuthStore(t.db);
  },
};

const user = (n: number, over: Partial<UserRow> = {}): UserRow => ({ id: `user_${n}`, email: `u${n}@example.com`, name: `User ${n}`, passwordHash: "h", workspaceId: `acct_${n}`, createdAt: "2026-10-30T00:00:00.000Z", ...over });
const session = (id: string, userId: string, createdAt: number, expiresAt = createdAt + 1000) => ({ id, userId, createdAt, lastSeenAt: createdAt, expiresAt });

describe.each(Object.keys(stores))("AuthStore contract (%s)", (name) => {
  it("keeps emails unique and finds users by email and id", async () => {
    const s = await stores[name]();
    await s.createUser(user(1));
    await expect(s.createUser(user(2, { email: "u1@example.com" }))).rejects.toBeInstanceOf(EmailTakenError);
    expect((await s.getUserByEmail("u1@example.com"))?.id).toBe("user_1");
    expect((await s.getUserById("user_1"))?.workspaceId).toBe("acct_1");
    expect(await s.getUserByEmail("nobody@example.com")).toBeNull();
    await s.setPasswordHash("user_1", "newhash");
    expect((await s.getUserById("user_1"))?.passwordHash).toBe("newhash");
  });

  it("joins a session to its user, touches it, deletes it", async () => {
    const s = await stores[name]();
    await s.createUser(user(1));
    await s.createSession(session("aaa", "user_1", 1000));
    expect((await s.findSession("aaa"))?.user.email).toBe("u1@example.com");
    await s.touchSession("aaa", 5000, 9000);
    expect((await s.findSession("aaa"))?.session).toMatchObject({ lastSeenAt: 5000, expiresAt: 9000, createdAt: 1000 });
    await s.deleteSession("aaa");
    expect(await s.findSession("aaa")).toBeNull();
    expect(await s.findSession("never-issued")).toBeNull();
  });

  it("trims a user's sessions to the newest, protecting the one in use, and sweeps expired ones", async () => {
    const s = await stores[name]();
    await s.createUser(user(1));
    await s.createUser(user(2));
    for (let i = 0; i < 5; i++) await s.createSession(session(`s${i}`, "user_1", 1000 + i, 100_000));
    await s.createSession(session("other", "user_2", 1, 100_000));
    await s.trimSessions("user_1", 2, "s0");
    const left = (await Promise.all(["s0", "s1", "s2", "s3", "s4", "other"].map((id) => s.findSession(id)))).map((r) => r?.session.id ?? null);
    expect(left).toEqual(["s0", null, null, "s3", "s4", "other"]);
    await s.createSession(session("old", "user_2", 1, 50));
    await s.deleteExpiredSessions(60_000_000);
    expect(await s.findSession("old")).toBeNull();
  });

  it("deleting a user removes their sessions and onboarding record, and nobody else's", async () => {
    const s = await stores[name]();
    await s.createUser(user(1));
    await s.createUser(user(2));
    await s.createSession(session("a", "user_1", 1));
    await s.createSession(session("b", "user_2", 1));
    const doc = { skipped: [] as never[], basicsConfirmed: true, current: null, updatedAt: 1 };
    await s.putOnboarding("acct_1", { ...doc, skipped: ["tools"] });
    await s.putOnboarding("acct_2", { ...doc });
    expect((await s.getOnboarding("acct_1"))?.skipped).toEqual(["tools"]);
    await s.deleteUser("user_1");
    expect(await s.getUserById("user_1")).toBeNull();
    expect(await s.getUserByEmail("u1@example.com")).toBeNull();
    expect(await s.findSession("a")).toBeNull();
    expect(await s.getOnboarding("acct_1")).toBeNull();
    expect(await s.findSession("b")).not.toBeNull();
    expect(await s.getOnboarding("acct_2")).not.toBeNull();
    await s.createUser(user(3, { email: "u1@example.com" })); // the address is free again
  });

  it("counts requests in a fixed window that restarts after it", async () => {
    const s = await stores[name]();
    expect((await s.hit("k", 1000, 10_000)).count).toBe(1);
    expect((await s.hit("k", 1000, 10_500)).count).toBe(2);
    expect(await s.hit("k", 1000, 10_900)).toEqual({ count: 3, at: 10_000 });
    expect(await s.hit("k", 1000, 11_000)).toEqual({ count: 1, at: 11_000 });
    expect((await s.hit("other", 1000, 11_000)).count).toBe(1);
  });

  it("counts failures, remembers the last one, forgets after the reset time, clears on demand", async () => {
    const s = await stores[name]();
    expect(await s.peek("f")).toBeNull();
    expect((await s.fail("f", 5000, 1000)).count).toBe(1);
    expect((await s.fail("f", 5000, 2000)).count).toBe(2);
    expect(await s.peek("f")).toEqual({ count: 2, at: 2000 });
    expect((await s.fail("f", 5000, 8000)).count).toBe(1); // 6 s since the last failure: forgotten
    await s.clear("f");
    expect(await s.peek("f")).toBeNull();
    await s.hit("old", 1000, 5);
    await s.hit("new", 1000, 50_000);
    await s.deleteExpiredCounters(1000);
    expect(await s.peek("old")).toBeNull();
    expect(await s.peek("new")).not.toBeNull();
  });

  it("is atomic under concurrent requests: parallel hits are all counted", async () => {
    const s = await stores[name]();
    const results = await Promise.all(Array.from({ length: 25 }, () => s.hit("burst", 60_000, 1_000)));
    expect(Math.max(...results.map((r) => r.count))).toBe(25);
  });
});

describe.each(["memory", "file", "kv"] as const)("Repo.deleteWorkspace (%s)", (driver) => {
  it("removes the workspace with its chain, stores, menu, editions, cards and caches, and leaves other workspaces alone", async () => {
    const { sampleSeed } = await import("@/server/sample/chain");
    const { cardFor, cleanEdition } = await import("../e/helpers");
    const repo = await makeRepo(driver);
    const keep = await repo.createWorkspace({ ...sampleSeed(), workspaceId: "acct_keep" } as never);
    const seed = sampleSeed();
    const gone = await repo.createWorkspace({ chain: { ...seed.chain, id: "chain_gone" }, stores: seed.stores.map((x) => ({ ...x, id: `${x.id}~gone`, chainId: "chain_gone" })), menu: seed.menu, workspaceId: "acct_gone" } as never);
    const goneStore = `${seed.stores[0].id}~gone`;
    const edition = { ...cleanEdition(seed.stores[0].id, "ed_gone"), storeId: goneStore };
    await repo.putEdition(edition);
    await repo.putStaffCard(cardFor(edition, "tok_gone_0000001"));
    await repo.cachePut(`qloo:profile:v1:${goneStore}:x`, { profile: { evidenceIds: [] }, evidence: [] }, 600);

    expect(await repo.deleteWorkspace(gone.id)).toBe(true);
    expect(await repo.getWorkspace(gone.id)).toBeNull();
    expect(await repo.getChain("chain_gone")).toBeNull();
    expect(await repo.listStores("chain_gone")).toEqual([]);
    expect(await repo.listMenu("chain_gone")).toEqual([]);
    expect(await repo.getEdition("ed_gone")).toBeNull();
    expect(await repo.getStaffCardByToken("tok_gone_0000001")).toBeNull();
    expect(await repo.cacheGet(`qloo:profile:v1:${goneStore}:x`)).toBeNull();
    expect(await repo.deleteWorkspace(gone.id)).toBe(false); // safe to repeat
    expect(await repo.getWorkspace(keep.id)).not.toBeNull();
    expect(await repo.listStores(keep.chainId)).toHaveLength(8);
  });
});
