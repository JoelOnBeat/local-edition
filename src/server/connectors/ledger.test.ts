import { afterAll, describe, expect, it } from "vitest";
import type { Delivery, SyncEvent } from "@/contract";
import { openTestD1 } from "../store/d1-test-utils";
import { D1Ledger } from "./ledger-d1";
import { MemoryLedger } from "./ledger-memory";
import type { ConnectorLedger, StoredConnection } from "./types";

const conn = (merchantId: string, label: string): StoredConnection => ({
  connection: {
    provider: "square", status: "connected", mode: "sandbox", accountLabel: label, connectedAt: "2026-10-30T10:00:00.000Z",
    lastSyncAt: null, error: null, capabilities: ["Reads the menu"],
  },
  merchantId, tokenEnc: "v1.aaa.bbb", refreshEnc: null, tokenExpiresAt: null, meta: { lastWebhookAt: null },
});
const event = (id: string, at: string, provider: SyncEvent["provider"] = "square"): SyncEvent => ({ id, provider, at, direction: "in", kind: "menu.imported", summary: "x", storeId: null, editionId: null, ok: true });
const delivery = (itemId: string | null, status: Delivery["status"]): Delivery => ({ provider: "square", editionId: "ed_1", itemId, status, externalId: "SQ1", url: null, at: "2026-10-30T10:00:00.000Z", note: "v0" });

const d1 = await openTestD1();
afterAll(() => d1.dispose());

describe.each<[string, () => ConnectorLedger]>([
  ["memory", () => new MemoryLedger()],
  ["d1 (real SQL, migrations/0003_square.sql)", () => new D1Ledger(d1.db)],
])("connector ledger: %s", (name, make) => {
  const ws = (s: string) => `${name.slice(0, 2)}_${s}`;

  it("stores a connection per workspace and provider, replaces it, deletes it", async () => {
    const l = make();
    expect(await l.getConnection(ws("a"), "square")).toBeNull();
    await l.putConnection(ws("a"), "square", conn("M1", "one"));
    await l.putConnection(ws("a"), "square", conn("M1", "two"));
    expect((await l.getConnection(ws("a"), "square"))!.connection.accountLabel).toBe("two");
    expect(await l.getConnection(ws("b"), "square")).toBeNull();
    await l.deleteConnection(ws("a"), "square");
    expect(await l.getConnection(ws("a"), "square")).toBeNull();
  });

  it("routes a merchant to its workspaces, newest first, and caps the fan-out", async () => {
    const l = make();
    for (const w of ["x1", "x2", "x3"]) await l.putConnection(ws(w), "square", conn("MSHARED", w));
    await l.putConnection(ws("y1"), "square", conn("MOTHER", "other"));
    const hit = await l.findByMerchant("square", "MSHARED", 2);
    expect(hit).toHaveLength(2);
    expect(hit.every((h) => h.stored.merchantId === "MSHARED")).toBe(true);
    expect(await l.findByMerchant("square", "MNONE", 5)).toEqual([]);
  });

  it("lists events newest first, per provider, limited", async () => {
    const l = make();
    await l.addEvent(ws("e"), event(`${name}-1`, "2026-10-30T10:00:00.000Z"));
    await l.addEvent(ws("e"), event(`${name}-2`, "2026-10-30T11:00:00.000Z"));
    await l.addEvent(ws("e"), event(`${name}-3`, "2026-10-30T12:00:00.000Z", "slack"));
    expect((await l.listEvents(ws("e"), "square", 10)).map((e) => e.id)).toEqual([`${name}-2`, `${name}-1`]);
    expect(await l.listEvents(ws("e"), null, 10)).toHaveLength(3);
    expect(await l.listEvents(ws("e"), null, 1)).toHaveLength(1);
    expect(await l.listEvents(ws("other"), null, 10)).toEqual([]);
  });

  it("keeps one delivery per (edition, item) and overwrites it", async () => {
    const l = make();
    await l.putDelivery(ws("d"), delivery("it_1", "failed"));
    await l.putDelivery(ws("d"), delivery("it_1", "sent"));
    await l.putDelivery(ws("d"), delivery(null, "sent"));
    expect((await l.getDelivery(ws("d"), "square", "ed_1", "it_1"))!.status).toBe("sent");
    expect(await l.listDeliveries(ws("d"), "ed_1")).toHaveLength(2);
    expect(await l.getDelivery(ws("d"), "slack", "ed_1", "it_1")).toBeNull();
    expect(await l.listDeliveries(ws("other"), "ed_1")).toEqual([]);
  });

  it("replaces location links wholesale", async () => {
    const l = make();
    await l.replaceLocationLinks(ws("l"), [{ locationId: "L1", name: "A", storeId: "s1" }, { locationId: "L2", name: "B", storeId: null }]);
    await l.replaceLocationLinks(ws("l"), [{ locationId: "L3", name: "C", storeId: "s3" }]);
    expect(await l.listLocationLinks(ws("l"))).toEqual([{ locationId: "L3", name: "C", storeId: "s3" }]);
  });

  it("OAuth state: single use, bound to the provider, expires", async () => {
    const l = make();
    await l.putOAuthState(`${name}-s1`, ws("o"), "square", 600);
    expect(await l.consumeOAuthState(`${name}-s1`, "slack")).toBeNull(); // wrong provider burns it too
    expect(await l.consumeOAuthState(`${name}-s1`, "square")).toBeNull();
    await l.putOAuthState(`${name}-s2`, ws("o"), "square", 600);
    expect(await l.consumeOAuthState(`${name}-s2`, "square")).toBe(ws("o"));
    expect(await l.consumeOAuthState(`${name}-s2`, "square")).toBeNull();
    await l.putOAuthState(`${name}-s3`, ws("o"), "square", -5);
    expect(await l.consumeOAuthState(`${name}-s3`, "square")).toBeNull();
  });

  it("mints one calendar token per (workspace, scope, store) and resolves it", async () => {
    const l = make();
    let n = 0;
    const mint = () => `${name.slice(0, 2)}tok${"x".repeat(20)}${n++}`;
    const a = await l.getOrCreateCalendarToken(ws("c"), "store", "s1", mint);
    expect(await l.getOrCreateCalendarToken(ws("c"), "store", "s1", mint)).toBe(a);
    const chain = await l.getOrCreateCalendarToken(ws("c"), "chain", null, mint);
    expect(chain).not.toBe(a);
    expect(await l.resolveCalendarToken(a)).toEqual({ token: a, workspaceId: ws("c"), scope: "store", storeId: "s1" });
    expect(await l.resolveCalendarToken(chain)).toMatchObject({ scope: "chain", storeId: null });
    expect(await l.resolveCalendarToken("nope")).toBeNull();
  });
});
