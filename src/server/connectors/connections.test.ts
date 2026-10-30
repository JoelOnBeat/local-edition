import { describe, expect, it } from "vitest";
import { ConnectionsResponse } from "@/contract";
import { recordEvent } from "./comms/events";
import { makeHarness, NOW } from "./comms/test-utils";
import { buildConnections } from "./connections";
import { MemoryLedger } from "./ledger-memory";
import { readSquareConfig } from "./square/config";
import { connectSandbox } from "./square/connect";
import { fakeSquare, TEST_ENV } from "./square/test-utils";
import type { SquareDeps } from "./square/deps";

async function setup() {
  const h = await makeHarness();
  const square: SquareDeps = { ledger: new MemoryLedger(), repo: h.repo, config: readSquareConfig(TEST_ENV), fetchImpl: fakeSquare().fetch, now: () => NOW };
  return { h, square };
}

describe("buildConnections (GET /api/connections)", () => {
  it("lists Square, Slack, Gmail, Outlook and the calendar, and every lane's events newest first", async () => {
    const { h, square } = await setup();
    await connectSandbox(square, h.workspace.id);
    await recordEvent(h.store, h.workspace.id, { provider: "slack", direction: "out", kind: "digest.posted", summary: "Digest posted.", storeId: null, editionId: null, ok: true, at: new Date(NOW.getTime() + 60_000).toISOString() });
    const out = await buildConnections(square, h.deps, h.workspace.id);
    expect(ConnectionsResponse.safeParse(out).success).toBe(true);
    expect(out.connections.map((c) => c.provider)).toEqual(["square", "slack", "gmail", "outlook", "calendar"]);
    expect(out.connections[0].status).toBe("connected");
    expect(out.events[0]).toMatchObject({ provider: "slack", kind: "digest.posted" });
    expect(out.events.some((e) => e.provider === "square" && e.kind === "menu.imported")).toBe(true);
    const times = out.events.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("derives the calendar row from approved event nights", async () => {
    const { h, square } = await setup();
    const none = await buildConnections(square, h.deps, h.workspace.id);
    expect(none.connections.find((c) => c.provider === "calendar")?.status).toBe("not_connected");
    const edition = h.editions[0];
    const event = edition.items.find((i) => i.kind === "event")!;
    await h.repo.updateEditionItem(edition.id, { ...event, status: "approved" }, event.version);
    const some = await buildConnections(square, h.deps, h.workspace.id);
    expect(some.connections.find((c) => c.provider === "calendar")).toMatchObject({ status: "connected", accountLabel: "1 event night in the chain feed" });
  });

  it("one lane failing does not hide the others", async () => {
    const { h, square } = await setup();
    const broken: SquareDeps = { ...square, ledger: new Proxy(square.ledger, { get: () => () => { throw new Error("d1 down"); } }) };
    const out = await buildConnections(broken, h.deps, h.workspace.id);
    expect(out.connections.map((c) => c.provider)).toEqual(["slack", "gmail", "outlook", "calendar"]);
  });
});
