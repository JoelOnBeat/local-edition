import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client";
import { mockEditions } from "@/mocks";

const sse = (frames: string) => new Response(new TextEncoder().encode(frames), { status: 200, headers: { "content-type": "text/event-stream" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("http client: connector routes", () => {
  it("resumeBuild sends Last-Event-ID and yields each event with its parsed id", async () => {
    const fetchImpl = vi.fn(async () =>
      sse(`: open\n\nid: 7\ndata: ${JSON.stringify({ type: "store_started", storeId: "s1" })}\n\n: ping\n\nid: 8\ndata: ${JSON.stringify({ type: "run_done", runId: "r1", editionIds: ["e1"] })}\n\ndata: {torn\n\n`),
    );
    const api = createApiClient({ mode: "app", fetchImpl: fetchImpl as unknown as typeof fetch });
    const got = [];
    for await (const e of api.resumeBuild(6)) got.push(e);
    expect(got.map((g) => [g.seq, g.event.type])).toEqual([[7, "store_started"], [8, "run_done"]]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/editions/build");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["last-event-id"]).toBe("6");
    expect((init.headers as Record<string, string>).accept).toBe("text/event-stream");
  });

  it("listDeliveries and getConnections validate the answer and surface { error, code } failures", async () => {
    const delivery = { provider: "square", editionId: "e1", itemId: "i1", status: "sent", externalId: "X", url: null, at: "2026-10-30T08:00:00.000Z", note: null };
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("/api/connectors/deliveries")
        ? json({ deliveries: [delivery] })
        : url === "/api/connections" ? json({ connections: [], events: [] }) : json({ error: "No.", code: "boom" }, 500));
    const api = createApiClient({ mode: "app", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await api.listDeliveries("e 1")).toEqual([delivery]);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/connectors/deliveries?editionId=e%201");
    expect(await api.getConnections()).toEqual({ connections: [], events: [] });
    await expect(api.getComms()).rejects.toMatchObject({ status: 500, code: "boom" });
    const bad = createApiClient({ mode: "app", fetchImpl: (async () => json({ deliveries: "nope" })) as unknown as typeof fetch });
    await expect(bad.listDeliveries("e1")).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("mock client: approval to delivery to sync log", () => {
  it("approving a special posts it to Square and approving every item sends the card to Slack and mail", async () => {
    const api = createApiClient({ mode: "mock", mockDelayMs: 0, mockEventDelayMs: 0 });
    const draft = mockEditions.find((e) => e.status === "draft")!;
    const before = await api.listDeliveries(draft.id);
    expect(before).toEqual([]);
    const special = draft.items.find((i) => i.kind === "special")!;
    await api.patchItem(draft.id, special.id, { action: "approve" }, special.version);
    expect((await api.listDeliveries(draft.id)).map((d) => d.provider)).toEqual(["square"]);
    await api.approveAll(draft.id);
    const after = (await api.listDeliveries(draft.id)).map((d) => d.provider).sort();
    expect(after).toEqual(["gmail", "slack", "square"]);
    const log = await api.getConnections();
    expect(log.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["special.published", "card.posted", "mail.sent"]));
    expect(log.connections.map((c) => c.provider)).toEqual(["square", "slack", "gmail", "outlook", "calendar"]);
  });

  it("a suggestion is accepted once and then leaves the open list", async () => {
    const api = createApiClient({ mode: "mock", mockDelayMs: 0, mockEventDelayMs: 0 });
    const open = (await api.getComms()).suggestions;
    expect(open.length).toBeGreaterThan(0);
    await api.patchSuggestion(open[0].id, "applied");
    expect((await api.getComms()).suggestions.map((s) => s.id)).not.toContain(open[0].id);
    await expect(api.patchSuggestion("nope", "dismissed")).rejects.toMatchObject({ status: 404 });
  });
});
