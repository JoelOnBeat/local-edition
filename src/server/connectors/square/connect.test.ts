import { describe, expect, it } from "vitest";
import { connectSandbox, squareStatus } from "./connect";
import { importFromSquare } from "./sync";
import { harness } from "./test-utils";

describe("connecting the sample chain to the Square sandbox", () => {
  it("imports the menu and 8 locations, links them to the stores, and reports a connected status", async () => {
    const h = await harness();
    const result = await connectSandbox(h.deps, h.workspaceId);
    expect(result.menu).toMatchObject({ added: 0, removed: 0, changed: 0, total: 22 });
    expect(result.stores).toEqual({ linked: 8, created: 0 });
    const status = await squareStatus(h.deps, h.workspaceId);
    expect(status.connection).toMatchObject({ status: "connected", mode: "sandbox", accountLabel: "Kettle & Kiln (sample chain) · Square sandbox" });
    expect(status.merchantId).toBe("MLTESTMERCHANT");
    expect(status.locations).toHaveLength(8);
    expect(status.locations.every((l) => l.storeId && l.storeName)).toBe(true);
    expect(status.sandboxAvailable).toBe(true);
    expect(status.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["menu.imported", "connection.created"]));
    expect(status.events[0].kind).toBe("menu.imported"); // newest first, even within the same millisecond
    expect(JSON.stringify(status)).not.toMatch(/sandbox-token-for-tests/);
    // every call pins the version and uses the sandbox token against the sandbox host
    for (const c of h.fake.calls) expect(c.headers["square-version"]).toBe("2026-09-16");
    expect(h.fake.calls[0].headers.authorization).toBe("Bearer sandbox-token-for-tests");
  });

  it("503 square_not_configured when the server has no sandbox token", async () => {
    const h = await harness({ SQUARE_MODE: "live" });
    await expect(connectSandbox(h.deps, h.workspaceId)).rejects.toMatchObject({ status: 503, code: "square_not_configured" });
    expect(await h.ledger.getConnection(h.workspaceId, "square")).toBeNull();
  });

  it("a Square outage during the first import leaves the menu untouched and reports it", async () => {
    const h = await harness();
    h.fake.failNext.set("/v2/locations", { status: 500, times: 10 });
    const before = await h.repo.listMenu("chain_kettle_kiln");
    await expect(connectSandbox(h.deps, h.workspaceId)).rejects.toBeTruthy();
    expect(await h.repo.listMenu("chain_kettle_kiln")).toEqual(before);
  });

  it("keeps the menu when Square's catalog is empty", async () => {
    const h = await harness();
    await connectSandbox(h.deps, h.workspaceId);
    h.fake.catalog.clear();
    const r = await importFromSquare(h.deps, h.workspaceId, { reason: "sync" });
    expect(r.menu.total).toBe(22);
    expect((await h.ledger.listEvents(h.workspaceId, "square", 5)).some((e) => e.kind === "menu.empty" && !e.ok)).toBe(true);
  });

  it("creates a store for a Square location with no matching store", async () => {
    const h = await harness();
    h.fake.locations.push({ id: "LOC_9", name: "Kettle & Kiln Hoboken", status: "ACTIVE", address: { address_line_1: "1 Washington St", locality: "Hoboken" } });
    const r = await connectSandbox(h.deps, h.workspaceId);
    expect(r.stores).toEqual({ linked: 8, created: 1 });
    expect((await h.repo.listStores("chain_kettle_kiln")).find((s) => s.name === "Kettle & Kiln Hoboken")?.addressLabel).toBe("1 Washington St, Hoboken");
  });

  it("a second import while one is running is refused, not doubled", async () => {
    const h = await harness();
    await connectSandbox(h.deps, h.workspaceId);
    const held = await h.repo.acquireLock(`square-sync:${h.workspaceId}`, 60);
    await expect(importFromSquare(h.deps, h.workspaceId, { reason: "sync" })).rejects.toMatchObject({ status: 409, code: "sync_running" });
    await h.repo.releaseLock(`square-sync:${h.workspaceId}`, held!);
  });

  it("409 square_not_connected before connecting", async () => {
    const h = await harness();
    await expect(importFromSquare(h.deps, h.workspaceId, { reason: "sync" })).rejects.toMatchObject({ status: 409, code: "square_not_connected" });
  });
});
