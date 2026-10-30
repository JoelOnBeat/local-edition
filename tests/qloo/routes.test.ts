import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Evidence, ProfileResponse, CompareResponse, type WorkspaceBundle } from "@/contract";
import { resetEnvCache } from "@/lib/env";
import { getWorkspace } from "@/server/handlers/workspace";
import { MemoryRecorder, setRecorder } from "@/server/http/recorder";
import { resetQlooClient } from "@/server/qloo/client";
import { setRepo, type Repo } from "@/server/store";
import { createMemoryRepo } from "@/server/store/memory";
import { GET as searchGET } from "@/app/api/anchors/search/route";
import { GET as profileGET } from "@/app/api/stores/[id]/profile/route";
import { GET as compareGET } from "@/app/api/compare/route";

const KEY = "qk_route_SECRET_987654";
let repo: Repo;

function setEnv(env: Record<string, string>) {
  for (const k of ["QLOO_MODE", "QLOO_API_KEY"]) delete process.env[k];
  Object.assign(process.env, env);
  resetEnvCache();
  resetQlooClient();
}

beforeEach(() => {
  setEnv({ QLOO_MODE: "fixture" });
  repo = createMemoryRepo();
  setRepo(repo);
  setRecorder(new MemoryRecorder());
});
afterEach(() => {
  setRepo(undefined);
  setRecorder(undefined);
  vi.unstubAllGlobals();
  setEnv({});
});

const req = (path: string, cookie?: string, ip = "10.1.1.1") =>
  new Request(`http://localhost${path}`, { headers: { ...(cookie ? { cookie } : {}), "cf-connecting-ip": ip } });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function visit(ip = "10.1.1.1") {
  const res = await getWorkspace(req("/api/workspace", undefined, ip));
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return { cookie, bundle: (await res.json()) as WorkspaceBundle };
}

describe("T3 GET /api/stores/:id/profile", () => {
  it("returns a contract-valid profile with evidence, and stores the evidence", async () => {
    const { cookie, bundle } = await visit();
    const s = bundle.stores[0];
    const res = await profileGET(req(`/api/stores/${s.id}/profile`, cookie), idParams(s.id));
    expect(res.status).toBe(200);
    const body = ProfileResponse.parse(await res.json());
    expect(body.profile.storeId).toBe(s.id);
    expect(body.profile.tags.length).toBeGreaterThanOrEqual(8);
    body.evidence.forEach((e) => Evidence.parse(e));
    expect(body.evidence.every((e) => e.mode === "fixture")).toBe(true);
    const saved = await repo.getEvidence(body.profile.evidenceIds);
    expect(saved.map((e) => e.id).sort()).toEqual(body.profile.evidenceIds.slice().sort());
  });

  it("serves the second request from the cache (same profile, no recompute)", async () => {
    const { cookie, bundle } = await visit();
    const s = bundle.stores[3];
    const a = await (await profileGET(req(`/x`, cookie), idParams(s.id))).json();
    const b = await (await profileGET(req(`/x`, cookie), idParams(s.id))).json();
    expect(b).toEqual(a);
    expect(a.profile.computedAt).toBe(b.profile.computedAt);
  });

  it("404s for an unknown store and for another visitor's store", async () => {
    const one = await visit("10.1.1.1");
    const two = await visit("10.1.1.2");
    const missing = await profileGET(req("/x", one.cookie), idParams("store_nope"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
    const foreign = await profileGET(req("/x", one.cookie), idParams(two.bundle.stores[0].id));
    expect(foreign.status).toBe(404);
  });

  it("maps upstream failures to { error, code } with a safe message", async () => {
    setEnv({ QLOO_MODE: "live", QLOO_API_KEY: KEY });
    const fetchMock = vi.fn(async () => new Response('{"error":{"reason":"upstream internals"}}', { status: 429, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { cookie, bundle } = await visit();
    const res = await profileGET(req("/x", cookie), idParams(bundle.stores[0].id));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ code: "qloo_unavailable" });
    expect(text).not.toContain("upstream internals");
    expect(text).not.toContain(KEY);
    for (const [url, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).not.toContain(KEY);
      expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe(KEY);
    }
  });

  it("maps 401 to qloo_unavailable (503) without blaming the visitor", async () => {
    setEnv({ QLOO_MODE: "live", QLOO_API_KEY: KEY });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { cookie, bundle } = await visit();
    const res = await profileGET(req("/x", cookie), idParams(bundle.stores[0].id));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "qloo_unavailable" });
  });
});

describe("T3 GET /api/compare", () => {
  it("compares two stores of the visitor's chain", async () => {
    const { cookie, bundle } = await visit();
    const [a, b] = [bundle.stores[3], bundle.stores[6]];
    const res = await compareGET(req(`/api/compare?a=${a.id}&b=${b.id}`, cookie));
    expect(res.status).toBe(200);
    const body = CompareResponse.parse(await res.json());
    expect(body.result.a).toBe(a.id);
    expect(body.result.onlyA.length).toBeGreaterThan(0);
    expect(body.result.evidenceIds.length).toBe(body.evidence.length);
    expect((await repo.getEvidence(body.result.evidenceIds)).length).toBe(body.evidence.length);
  });

  it("400s on the same store twice or missing params, 404s on foreign or unknown stores", async () => {
    const one = await visit("10.1.1.1");
    const two = await visit("10.1.1.2");
    const [a, b] = one.bundle.stores;
    const same = await compareGET(req(`/api/compare?a=${a.id}&b=${a.id}`, one.cookie));
    expect(same.status).toBe(400);
    expect(await same.json()).toMatchObject({ code: "same_store" });
    expect((await compareGET(req(`/api/compare?a=${a.id}`, one.cookie))).status).toBe(400);
    expect((await compareGET(req(`/api/compare?a=${a.id}&b=${two.bundle.stores[0].id}`, one.cookie))).status).toBe(404);
    expect((await compareGET(req(`/api/compare?a=${a.id}&b=nope`, one.cookie))).status).toBe(404);
    expect((await compareGET(req(`/api/compare?a=${a.id}&b=${b.id}`, one.cookie))).status).toBe(200);
  });
});

describe("T3 GET /api/anchors/search", () => {
  it("returns brand entity refs for a query", async () => {
    const res = await searchGET(req("/api/anchors/search?q=blue%20bottle"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ name: "Blue Bottle Coffee", type: "urn:entity:brand" });
  });

  it("returns [] when nothing matches and 400 for an empty or oversized query", async () => {
    expect(await (await searchGET(req("/api/anchors/search?q=zzzzzz-nothing"))).json()).toEqual([]);
    expect((await searchGET(req("/api/anchors/search?q="))).status).toBe(400);
    expect((await searchGET(req("/api/anchors/search"))).status).toBe(400);
    expect((await searchGET(req(`/api/anchors/search?q=${"a".repeat(81)}`))).status).toBe(400);
  });
});
