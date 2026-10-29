import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, routeTable, type RouteId } from "@/contract";
import * as editions from "@/server/handlers/editions";
import * as jobs from "@/server/handlers/jobs";
import * as workspace from "@/server/handlers/workspace";
import { fakePorts, freshApp, json, req } from "./helpers";

type Handler = (r: Request, a?: { params: Promise<Record<string, string>> }) => Promise<Response>;
const p = (v: Record<string, string>) => ({ params: Promise.resolve(v) });

/** One invalid request per stream-E route. Each must come back as a 4xx `{ error, code }`. */
const bad: Partial<Record<RouteId, { h: Handler; r: () => Request; a?: ReturnType<typeof p>; status: number; code: string }>> = {
  putChain: { h: workspace.putChain, r: () => req("/api/chain", json({ name: "", brandVoice: [], anchors: [] }, { method: "PUT" })), status: 400, code: "invalid_input" },
  importStores: { h: workspace.importStores, r: () => req("/api/stores/import", { method: "POST", body: "name,address\nA,B" }), status: 400, code: "invalid_csv" },
  createStore: { h: workspace.createStore, r: () => req("/api/stores", json({ name: "A", addressLabel: "B", lat: 123, lon: 0 })), status: 400, code: "invalid_input" },
  deleteStore: { h: workspace.deleteStore, r: () => req("/api/stores/x", { method: "DELETE" }), a: p({ id: "store_nope" }), status: 404, code: "not_found" },
  putMenu: { h: workspace.putMenu, r: () => req("/api/menu", json([{ id: "m" }], { method: "PUT" })), status: 400, code: "invalid_input" },
  listEditions: { h: editions.listEditions, r: () => req("/api/editions?weekOf=next-tuesday"), status: 400, code: "invalid_input" },
  getEdition: { h: editions.getEdition, r: () => req("/api/editions/x"), a: p({ id: "ed_nope" }), status: 404, code: "not_found" },
  patchItem: { h: editions.patchItem, r: () => req("/x", json({ action: "delete" }, { method: "PATCH" })), a: p({ id: "e", itemId: "i" }), status: 400, code: "invalid_input" },
  approveAll: { h: editions.approveAll, r: () => req("/x", { method: "POST" }), a: p({ id: "ed_nope" }), status: 404, code: "not_found" },
  getPublicCard: { h: editions.getPublicCard, r: () => req("/x"), a: p({ token: "nope" }), status: 404, code: "not_found" },
  runMondayJob: { h: jobs.runMondayJob, r: () => req("/api/jobs/monday", { ...json({ storeIds: "all" }), headers: { "content-type": "application/json", "x-le-signature": "ab" } }), status: 400, code: "invalid_input" },
};

beforeEach(() => { freshApp({ LE_JOB_SECRET: "s" }, fakePorts()); });

describe("T4 input validation on every stream E route", () => {
  const eRoutes = routeTable.filter((r) => r.stream === "E");

  it("has a failing-input case for every route that takes input", () => {
    const noInput = new Set<RouteId>(["getWorkspace", "getLatestJob", "getStatus"]);
    for (const r of eRoutes) expect(r.id in bad || noInput.has(r.id), `no invalid-input case for ${r.id}`).toBe(true);
  });

  it.each(Object.keys(bad) as RouteId[])("%s answers a bad request with {error, code} and no internals", async (id) => {
    const c = bad[id]!;
    const res = await c.h(c.r(), c.a);
    expect(res.status).toBe(c.status);
    const body = await res.json();
    expect(ApiError.safeParse(body).success).toBe(true);
    expect(body.code).toBe(c.code);
    expect(JSON.stringify(body)).not.toMatch(/stack|at \w+ \(|\.ts:|ZodError|node_modules/);
  });

  it("answers malformed JSON with invalid_json, not a 500", async () => {
    const res = await workspace.createStore(req("/api/stores", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_json" });
  });

  it("does not create a workspace for a request that fails validation", async () => {
    const repo = freshApp();
    await workspace.createStore(req("/api/stores", json({ nope: true })));
    expect(await repo.listWorkspaces()).toEqual([]);
  });

  it("turns an unexpected repo failure into a generic 500 {error, code} with no internals", async () => {
    const repo = freshApp();
    repo.getWorkspace = async () => { throw new Error("D1_ERROR: SQLITE_BUSY at /secret/path.ts:12"); };
    const res = await workspace.getWorkspace(req("/api/workspace"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Something went wrong on our side.", code: "internal" });
  });
});
