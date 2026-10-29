import { describe, expect, it } from "vitest";
import { routes, type AgentEvent } from "@/contract";
import { mockEditions, mockStatus, mockBuildEvents } from "@/mocks";
import { HttpError, UpstreamError } from "./errors";
import { apiError, withRoute } from "./api";
import { sseResponse } from "./sse";
import { parseSseStream } from "@/lib/sse-client";

const req = (url: string, init?: RequestInit) => new Request(`http://t.test${url}`, init);

describe("T2 apiError and withRoute", () => {
  it("apiError returns { error, code }", async () => {
    const res = apiError(404, "not_found", "No such store.");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No such store.", code: "not_found" });
  });

  it("validates query input and returns 400 with a safe message", async () => {
    const h = withRoute(routes.compareStores, () => ({}));
    const res = await h(req("/api/compare?a=x"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_input");
    expect(body.error).toContain("query.b");
  });

  it("assembles params, query and JSON body and returns JSON", async () => {
    const h = withRoute(routes.patchItem, ({ params, body }) => {
      expect(params).toEqual({ id: "ed_1", itemId: "i_1" });
      expect(body.action).toBe("reject");
      return mockEditions[0].items[0];
    });
    const res = await h(req("/x", { method: "PATCH", body: JSON.stringify({ action: "reject" }) }), { params: Promise.resolve({ id: "ed_1", itemId: "i_1" }) });
    expect(res.status).toBe(200);
  });

  it("400s on malformed JSON and an edit with an empty patch", async () => {
    const h = withRoute(routes.patchItem, () => mockEditions[0].items[0]);
    const args = { params: Promise.resolve({ id: "a", itemId: "b" }) };
    expect((await h(req("/x", { method: "PATCH", body: "{oops" }), args)).status).toBe(400);
    const empty = await h(req("/x", { method: "PATCH", body: JSON.stringify({ action: "edit", patch: {} }) }), args);
    expect(empty.status).toBe(400);
  });

  it("maps HttpError, UpstreamError and unknown errors without leaking details", async () => {
    const mk = (e: unknown) => withRoute(routes.getStatus, () => { throw e; });
    expect((await mk(new HttpError(409, "version_conflict", "Changed by someone else."))(req("/s"))).status).toBe(409);
    const cap = await mk(new UpstreamError("spend_cap", "tokenfactory", "Spend cap reached."))(req("/s"));
    expect(cap.status).toBe(402);
    expect((await cap.json()).code).toBe("spend_cap");
    const boom = await mk(new Error("password=hunter2 at /srv/app.js:12"))(req("/s"));
    expect(boom.status).toBe(500);
    const text = JSON.stringify(await boom.json());
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("/srv");
  });

  it("reads the raw body for HMAC routes and requires the signature header", async () => {
    const h = withRoute(routes.runMondayJob, (_in, ctx) => {
      expect(ctx.rawBody).toBe('{"storeIds":["s1"]}');
      return new Response("ok");
    });
    expect((await h(req("/j", { method: "POST", body: '{"storeIds":["s1"]}' }))).status).toBe(400);
    const res = await h(req("/j", { method: "POST", body: '{"storeIds":["s1"]}', headers: { "x-le-signature": "abc" } }));
    expect(await res.text()).toBe("ok");
  });

  it("flags a response that violates the contract outside production", async () => {
    const h = withRoute(routes.getStatus, () => ({ ...mockStatus, qloo: "nonsense" }));
    const res = await h(req("/s"));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("contract_violation");
  });

  it("multipart: accepts a png and rejects a gif", async () => {
    const h = withRoute(routes.readMenu, ({ body }) => [{ id: "m", name: body.image.name, category: "other", price: null, currency: "USD", description: null, source: "vl" }]);
    const good = new FormData();
    good.set("image", new File(["x"], "menu.png", { type: "image/png" }));
    expect((await h(req("/m", { method: "POST", body: good }))).status).toBe(200);
    const bad = new FormData();
    bad.set("image", new File(["x"], "menu.gif", { type: "image/gif" }));
    expect((await h(req("/m", { method: "POST", body: bad }))).status).toBe(400);
  });
});

describe("T2 SSE", () => {
  it("streams events as text/event-stream and parses back", async () => {
    const res = sseResponse(mockBuildEvents(["store_harlem"]), { heartbeatMs: 5 });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const got: AgentEvent[] = [];
    for await (const e of parseSseStream(res.body!)) got.push(e);
    expect(got[0].type).toBe("run_started");
    expect(got.at(-1)?.type).toBe("run_done");
  });

  it("sends heartbeats while idle", async () => {
    async function* slow(): AsyncGenerator<AgentEvent> {
      await new Promise((r) => setTimeout(r, 60));
      yield { type: "run_done", runId: "r", editionIds: [] };
    }
    const text = await sseResponse(slow(), { heartbeatMs: 10 }).text();
    expect(text).toContain(": ping");
    expect(text).toContain('"type":"run_done"');
  });

  it("turns a source failure into one generic error event", async () => {
    async function* broken(): AsyncGenerator<AgentEvent> {
      yield { type: "run_started", runId: "r", storeIds: [] };
      throw new Error("secret upstream detail");
    }
    const text = await sseResponse(broken()).text();
    expect(text).toContain('"code":"stream_failed"');
    expect(text).not.toContain("secret upstream detail");
  });
});
