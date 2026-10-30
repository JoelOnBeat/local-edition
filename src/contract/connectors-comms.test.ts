import { describe, expect, it } from "vitest";
import { Connection, Delivery, SyncEvent } from "./connectors";
import { CommsState, MailClassification, StoreCommsTarget, commsRoutes } from "./connectors-comms";
import { mockCommsState, mockCommsTargets } from "@/mocks/connectors-comms";

describe("comms contract and mocks", () => {
  it("the mock state parses against the contract", () => {
    expect(() => CommsState.parse(mockCommsState)).not.toThrow();
    for (const c of mockCommsState.connections) expect(() => Connection.parse(c)).not.toThrow();
    for (const e of mockCommsState.events) expect(() => SyncEvent.parse(e)).not.toThrow();
    for (const d of mockCommsState.deliveries) expect(() => Delivery.parse(d)).not.toThrow();
  });
  it("sample targets cover 8 stores with valid Slack channels", () => {
    expect(mockCommsTargets).toHaveLength(8);
    for (const t of mockCommsTargets) expect(() => StoreCommsTarget.parse(t)).not.toThrow();
    expect(mockCommsTargets[0].slackChannel).toBe("store-williamsburg");
    expect(mockCommsTargets[5].slackChannel).toBe("store-lower-east-side");
  });
  it("rejects an unknown category and a bad channel", () => {
    expect(MailClassification.safeParse({ category: "angry", summary: "x" }).success).toBe(false);
    expect(StoreCommsTarget.safeParse({ storeId: "s", slackChannel: "#Head Office", managerName: null, managerEmail: null }).success).toBe(false);
  });
  it("route paths are unique", () => {
    const keys = Object.values(commsRoutes).map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
