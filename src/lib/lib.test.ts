import { describe, expect, it, vi } from "vitest";
import { createApiClient, consumeEvents, ApiClientError } from "./api-client";
import { parseServerEnv } from "./env";
import { newId, newToken } from "./ids";
import { sseResponse } from "@/server/http/sse";
import { mockBuildEvents, mockEditions } from "@/mocks";

describe("T2 env", () => {
  it("defaults everything and treats empty strings as unset", () => {
    const e = parseServerEnv({ NEBIUS_API_KEY: "" });
    expect(e).toMatchObject({
      QLOO_MODE: "replay", TF_MODE: "replay", TAVILY_MODE: "replay", SPEND_CAP_USD: 5,
      GUARDRAILS_URL: "http://127.0.0.1:8000", STORE_DRIVER: "file",
    });
    expect(e.NEBIUS_API_KEY).toBeUndefined();
  });
  it("parses overrides and rejects bad enums", () => {
    expect(parseServerEnv({ SPEND_CAP_USD: "2.5", STORE_DRIVER: "kv", TF_MODE: "live" })).toMatchObject({ SPEND_CAP_USD: 2.5, STORE_DRIVER: "kv", TF_MODE: "live" });
    expect(() => parseServerEnv({ QLOO_MODE: "yolo" })).toThrow();
  });
});

describe("T2 ids", () => {
  it("makes prefixed unique ids and long tokens", () => {
    expect(newId("ed")).toMatch(/^ed_[0-9a-z]{16}$/);
    expect(newId("ed")).not.toBe(newId("ed"));
    expect(newToken()).toHaveLength(24);
  });
});

describe("mock-mode api client", () => {
  const api = createApiClient({ mode: "mock", mockDelayMs: 0, mockEventDelayMs: 0 });

  it("serves the workspace, imports CSV and creates and deletes stores", async () => {
    const ws = await api.getWorkspace();
    expect(ws.stores).toHaveLength(8);
    expect(ws.menu).toHaveLength(22);
    const added = await api.importStores("name,address,lat,lon\nGreenpoint,Manhattan Ave & Greenpoint Ave,40.7311,-73.9544\n");
    expect(added[0]).toMatchObject({ name: "Greenpoint", lat: 40.7311 });
    expect(await api.deleteStore(added[0].id)).toEqual({ ok: true });
    await expect(api.importStores("name,address,lat,lon\n,,,\n")).rejects.toBeInstanceOf(ApiClientError);
  });

  it("approves, rejects and edits items with guardrails", async () => {
    const ed = (await api.listEditions())[0];
    const special = ed.items.find((i) => i.kind === "special")!;
    expect((await api.patchItem(ed.id, special.id, { action: "approve" })).status).toBe("approved");
    const bad = await api.patchItem(ed.id, special.id, { action: "edit", patch: { description: "A healthy start that boosts your day" } });
    expect(bad.guardrail.status).toBe("blocked");
    const shouty = await api.patchItem(ed.id, special.id, { action: "edit", patch: { description: "Come and try it!" } });
    expect(shouty.guardrail.status).toBe("rewritten");
    await expect(api.patchItem(ed.id, "nope", { action: "approve" })).rejects.toMatchObject({ status: 404 });
  });

  it("approve-all skips unchecked items; streams build events; reads a public card", async () => {
    const lic = (await api.listEditions()).find((e) => e.storeId === "store_long-island-city")!;
    const all = await api.approveAll(lic.id);
    expect(all.items.find((i) => i.guardrail.status === "unchecked")?.status).not.toBe("approved");
    const events = await consumeEvents(api.buildEditions({ storeIds: ["store_harlem"] }));
    expect(events.at(-1)?.type).toBe("run_done");
    const card = await api.getCard(lic.id);
    expect((await api.getPublicCard(card.token)).store.id).toBe(lic.storeId);
    expect((await api.searchAnchors("blue")).map((a) => a.name)).toContain("Blue Bottle Coffee");
    expect((await api.getStatus()).guardrails).toBe("local");
  });
});

describe("http-mode api client", () => {
  it("builds URLs, validates responses and surfaces { error, code }", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      if (url.includes("/api/status")) return Response.json({ nope: true });
      if (url.includes("/api/compare")) return Response.json({ error: "Both stores need a profile.", code: "not_found" }, { status: 404 });
      if (url.includes("/api/editions?")) return Response.json([mockEditions[0]]);
      return Response.json(mockEditions[0]);
    });
    const api = createApiClient({ mode: "app", baseUrl: "http://t.test", fetchImpl: fetchImpl as never });
    await api.getEdition("ed 1");
    await api.listEditions("2026-10-26");
    expect(calls).toEqual(["GET http://t.test/api/editions/ed%201", "GET http://t.test/api/editions?weekOf=2026-10-26"]);
    await expect(api.getStatus()).rejects.toMatchObject({ code: "invalid_response" });
    await expect(api.compareStores("a", "b")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("consumes an SSE route end to end", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(mockBuildEvents(["store_astoria"])));
    const api = createApiClient({ mode: "app", fetchImpl: fetchImpl as never });
    const events = await consumeEvents(api.buildEditions({ storeIds: ["store_astoria"] }));
    expect(events[0].type).toBe("run_started");
    expect(events.at(-1)?.type).toBe("run_done");
  });
});
