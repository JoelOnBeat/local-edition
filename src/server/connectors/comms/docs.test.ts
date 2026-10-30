import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestD1 } from "../../store/d1-test-utils";
import { createD1DocDb, createMemoryDocDb, type DocDb } from "./docs";

/** The same contract on both drivers: memory (tests, dev) and D1 (production), the latter on real SQLite with migration 0004 applied. */
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => { await dispose?.(); dispose = undefined; });

const drivers: [string, () => Promise<DocDb>][] = [
  ["memory", async () => createMemoryDocDb()],
  ["d1", async () => { const t = await openTestD1(); dispose = t.dispose; return createD1DocDb(t.db); }],
];

describe.each(drivers)("%s doc store", (_name, make) => {
  let db: DocDb;
  beforeEach(async () => { db = await make(); });

  it("upserts, reads, lists newest first and deletes by workspace", async () => {
    await db.put({ workspaceId: "ws1", kind: "event", key: "a", ref: null, json: '{"n":1}', at: "2026-10-28T01:00:00.000Z" });
    await db.put({ workspaceId: "ws1", kind: "event", key: "b", ref: null, json: '{"n":2}', at: "2026-10-28T02:00:00.000Z" });
    await db.put({ workspaceId: "ws2", kind: "event", key: "a", ref: null, json: '{"n":3}', at: "2026-10-28T03:00:00.000Z" });
    await db.put({ workspaceId: "ws1", kind: "event", key: "a", ref: null, json: '{"n":9}', at: "2026-10-28T04:00:00.000Z" });
    expect(JSON.parse((await db.get("ws1", "event", "a"))!.json)).toEqual({ n: 9 });
    expect((await db.list("ws1", "event", 10)).map((r) => r.key)).toEqual(["a", "b"]);
    expect(await db.list("ws2", "event", 10)).toHaveLength(1);
    expect(await db.get("ws1", "event", "zzz")).toBeNull();
    await db.delete("ws1", "event");
    expect(await db.list("ws1", "event", 10)).toHaveLength(0);
    expect(await db.list("ws2", "event", 10)).toHaveLength(1);
  });

  it("finds a row by its secondary reference and claims a key once", async () => {
    await db.put({ workspaceId: "ws1", kind: "mail_conn", key: "gmail", ref: "ca_123", json: "{}", at: "2026-10-28T01:00:00.000Z" });
    expect((await db.findByRef("mail_conn", "ca_123"))?.workspaceId).toBe("ws1");
    expect(await db.findByRef("mail_conn", "ca_nope")).toBeNull();
    expect(await db.claim("k1", 1)).toBe(true);
    expect(await db.claim("k1", 2)).toBe(false);
    await db.release("k1");
    expect(await db.claim("k1", 3)).toBe(true);
  });
});
