import { describe, expect, it } from "vitest";
import type { CalendarFeed, Connection, SyncEvent } from "@/contract";
import { calendarConnection, mergeConnections } from "./connections";

const conn = (provider: Connection["provider"], status: Connection["status"] = "connected"): Connection => ({
  provider, status, mode: status === "connected" ? "sandbox" : null, accountLabel: null, connectedAt: null, lastSyncAt: null, error: null, capabilities: [],
});
const ev = (id: string, at: string, provider: SyncEvent["provider"] = "square"): SyncEvent => ({
  id, provider, at, direction: "in", kind: "menu.imported", summary: id, storeId: null, editionId: null, ok: true,
});
const feed = (scope: "chain" | "store", eventCount: number): CalendarFeed => ({
  scope, storeId: scope === "chain" ? null : "s1", label: "x", url: "https://x.test/a.ics", webcalUrl: "webcal://x.test/a.ics",
  googleUrl: "https://calendar.google.com/x", outlookUrl: "https://outlook.live.com/x", eventCount,
});

describe("calendarConnection", () => {
  it("is connected with the chain feed's event count when nights are approved", () => {
    const c = calendarConnection([feed("store", 1), feed("chain", 3)]);
    expect(c).toMatchObject({ provider: "calendar", status: "connected", accountLabel: "3 event nights in the chain feed" });
  });
  it("is not connected when there are no feeds or no approved nights yet", () => {
    expect(calendarConnection([]).status).toBe("not_connected");
    expect(calendarConnection([feed("chain", 0)])).toMatchObject({ status: "not_connected", accountLabel: null });
  });
});

describe("mergeConnections", () => {
  it("orders square, slack, gmail, outlook, calendar and sorts every event newest first without duplicates", () => {
    const merged = mergeConnections({
      square: conn("square"),
      comms: [conn("gmail"), conn("slack"), conn("outlook", "not_connected")],
      feeds: [feed("chain", 2)],
      events: [
        [ev("a", "2026-10-30T10:00:00.000Z"), ev("dup", "2026-10-30T12:00:00.000Z")],
        [ev("b", "2026-10-30T11:00:00.000Z", "slack"), ev("dup", "2026-10-30T12:00:00.000Z")],
      ],
    });
    expect(merged.connections.map((c) => c.provider)).toEqual(["square", "slack", "gmail", "outlook", "calendar"]);
    expect(merged.events.map((e) => e.id)).toEqual(["dup", "b", "a"]);
  });
  it("still lists the other connections when Square is unreadable", () => {
    const merged = mergeConnections({ square: null, comms: [conn("slack")], feeds: [], events: [] });
    expect(merged.connections.map((c) => c.provider)).toEqual(["slack", "calendar"]);
  });
});
