import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, Edition, JobRun } from "@/contract";
import { setAgentDeps } from "@/server/agent/deps";
import { acquireBuildLock } from "@/server/agent/build-lock";
import { buildEditions } from "@/server/agent/build";
import { buildRoute, cardRoute, regenerateRoute } from "@/server/agent/handlers";
import { getOrCreateCard } from "@/server/agent/card";
import { limitSpend } from "@/server/handlers/limit";
import { patchItem } from "@/server/handlers/editions";
import { executeJob } from "@/server/jobs/monday";
import { DRAFTING_MAX_AGE_MS } from "@/server/store/reaper";
import { setRepo } from "@/server/store";
import { WEEK_OF, collect, harness, type Harness } from "@/server/agent/test-utils";
import { req } from "./helpers";

/** M5 rebuild safety, the per-workspace build lock, and the rate limits on the spending routes. */

let h: Harness;
const args = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const cookieReq = (ws: string, path = "/x", init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, { ...init, headers: { "content-type": "application/json", cookie: `le_ws=${ws}`, "cf-connecting-ip": "10.5.5.5" } });
const build = (extra: Record<string, unknown> = {}) => collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF, ...extra }, h.deps));
const codes = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "error" ? [e.code] : []));
const editionOf = async (storeId: string) => (await h.repo.getEditionForWeek(storeId, WEEK_OF))!;

beforeEach(async () => {
  h = await harness({ storeCount: 2 });
  setRepo(h.repo);
  setAgentDeps(h.deps);
});
afterEach(() => {
  setRepo(undefined);
  setAgentDeps(undefined);
});

async function approveFirstItem(storeId: string) {
  const ed = await editionOf(storeId);
  return h.repo.updateEditionItem(ed.id, { ...ed.items[0], status: "approved" }, ed.items[0].version);
}

describe("M5 a rebuild keeps head office's work unless forced", () => {
  it("skips a store with an approved item, says has_approvals, and leaves its edition untouched", async () => {
    await build();
    const [a, b] = h.storeIds;
    const approved = await approveFirstItem(a);
    const before = await editionOf(a);

    const events = await build();
    expect(codes(events)).toEqual(["has_approvals"]);
    expect(events.find((e) => e.type === "error")).toMatchObject({ storeId: a });
    expect(events.some((e) => e.type === "store_started" && e.storeId === a)).toBe(false);
    expect(events.some((e) => e.type === "store_started" && e.storeId === b)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_done", editionIds: [(await editionOf(b)).id] });

    const after = await editionOf(a);
    expect(after).toEqual(before);
    expect(after.items[0]).toMatchObject({ id: approved.id, status: "approved" });
  });

  it("treats a hand-edited item the same way", async () => {
    await build();
    const ed = await editionOf(h.storeIds[0]);
    await h.repo.updateEditionItem(ed.id, { ...ed.items[0], status: "edited" }, ed.items[0].version);
    expect(codes(await build())).toEqual(["has_approvals"]);
  });

  it("rebuilds the store with force: true, reusing the edition id and dropping the approvals", async () => {
    await build();
    await approveFirstItem(h.storeIds[0]);
    const idBefore = (await editionOf(h.storeIds[0])).id;

    const events = await build({ force: true });
    expect(codes(events)).toEqual([]);
    const after = await editionOf(h.storeIds[0]);
    expect(after.id).toBe(idBefore);
    expect(after.status).toBe("draft");
    expect(after.items.every((i) => i.status === "draft")).toBe(true);
  });

  it("rebuilds a store nobody has touched without force", async () => {
    await build();
    expect(codes(await build())).toEqual([]);
  });

  it("refuses at the write when approvals landed while the agent was still working", async () => {
    await build();
    const [a] = h.storeIds;
    const real = h.deps.tavily.eventsThisWeek;
    h.deps.tavily = { eventsThisWeek: async (...a2) => { await approveFirstItem(a); return real(...a2); } }; // mid-build approval
    const events = await build({ storeIds: [a] });
    expect(codes(events)).toContain("has_approvals");
    const ed = await editionOf(a);
    expect(ed.items[0].status).toBe("approved");
    expect(ed.status).not.toBe("drafting");
  });

  it("lets the Monday job count a kept store as done, not failed", async () => {
    await h.repo.createWorkspace({ ...(await import("@/server/sample/chain")).sampleSeed(), workspaceId: "demo" } as never);
    const run: JobRun = { id: "job_t", trigger: "cron", startedAt: new Date().toISOString(), finishedAt: null, storeIds: ["store_harlem"], status: "running", nebiusJobId: null, note: "" };
    const ports = {
      background: () => undefined,
      buildEditions: async function* () {
        yield { type: "run_started", runId: "job_t", storeIds: ["store_harlem"] } as AgentEvent;
        yield { type: "error", storeId: "store_harlem", code: "has_approvals", message: "kept" } as AgentEvent;
        yield { type: "run_done", runId: "job_t", editionIds: [] } as AgentEvent;
      },
    };
    const done = await executeJob(run, { repo: h.repo, ports, now: () => new Date() });
    expect(done.status).toBe("done");
    expect(done.note).toContain("kept 1 with approvals");
    expect(done.note).not.toContain("error(s)");
  });

  it("flags stale drafting editions at the start of a build", async () => {
    await build({ storeIds: [h.storeIds[0]] });
    const ed = await editionOf(h.storeIds[0]);
    const stale = new Date(Date.now() - DRAFTING_MAX_AGE_MS - 60_000).toISOString();
    await h.repo.updateEdition(ed.id, (cur) => ({ ...cur, weekOf: cur.weekOf, status: "drafting", createdAt: stale }));
    // Build the other store only: the stale one is not rebuilt, so the start-of-build reaper must flag it.
    h.deps.now = () => new Date();
    await build({ storeIds: [h.storeIds[1]] });
    expect((await h.repo.getEdition(ed.id))!.status).toBe("flagged");
  });
});

describe("one build per workspace at a time", () => {
  it("answers 409 build_running before streaming while a build holds the lock", async () => {
    const lock = await acquireBuildLock(h.repo, h.workspaceId);
    const res = await buildRoute(cookieReq(h.workspaceId, "/api/editions/build", { method: "POST", body: "{}" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "build_running" });
    await h.repo.releaseLock(lock.name, lock.token);
    expect((await buildRoute(cookieReq(h.workspaceId, "/x", { method: "POST", body: "{}" }))).status).toBe(200);
  });

  it("lets exactly one of two simultaneous builds start, and releases the lock when the stream ends", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const real = h.deps.tavily.eventsThisWeek;
    h.deps.tavily = { eventsThisWeek: async (...a) => { await gate; return real(...a); } }; // keeps the first build running
    const post = () => buildRoute(cookieReq(h.workspaceId, "/x", { method: "POST", body: "{}" }));
    const results = await Promise.all([post(), post()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    release();
    await results.find((r) => r.status === 200)!.text();
    const again = await post();
    expect(again.status).toBe(200);
    await again.text();
  });

  it("yields a build_running error event to a caller that did not take the lock first (the Monday job)", async () => {
    await acquireBuildLock(h.repo, h.workspaceId);
    expect(codes(await build())).toEqual(["build_running"]);
  });

  it("releases the lock when the client leaves mid-stream", async () => {
    const abort = new AbortController();
    const res = await buildRoute(new Request("http://localhost/x", { method: "POST", body: "{}", signal: abort.signal, headers: { cookie: `le_ws=${h.workspaceId}`, "cf-connecting-ip": "10.5.5.5" } }));
    const reader = res.body!.getReader();
    await reader.read();
    abort.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(await h.repo.acquireLock(`build:${h.workspaceId}`, 60)).not.toBeNull();
  });

  it("accepts force and a store list of up to 50, and rejects more", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `store_${i}`);
    expect((await buildRoute(cookieReq(h.workspaceId, "/x", { method: "POST", body: JSON.stringify({ storeIds: many }) }))).status).toBe(400);
    const res = await buildRoute(cookieReq(h.workspaceId, "/x", { method: "POST", body: JSON.stringify({ force: true }) }));
    expect(res.status).toBe(200);
    await res.text();
  });
});

describe("H1 spending routes are rate limited per workspace and per IP", () => {
  const ctx = (ws: string, ip: string) => ({ workspace: { id: ws, chainId: "c", createdAt: "" }, request: req("/x", { ip }) });

  it("stops a workspace after its burst and answers 429 rate_limited", async () => {
    for (let i = 0; i < 4; i++) await limitSpend(ctx("ws_burst", "10.6.0.1"), "build");
    await expect(limitSpend(ctx("ws_burst", "10.6.0.1"), "build")).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    await limitSpend(ctx("ws_other", "10.6.0.2"), "build"); // another workspace and network are unaffected
  });

  it("stops one network address that spreads requests over many workspaces", async () => {
    for (let i = 0; i < 12; i++) await limitSpend(ctx(`ws_spread_${i}`, "10.6.0.9"), "build");
    await expect(limitSpend(ctx("ws_spread_13", "10.6.0.9"), "build")).rejects.toMatchObject({ status: 429 });
  });

  it("build: a fifth rapid build for one workspace gets 429 before any stream opens", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await buildRoute(cookieReq(h.workspaceId, "/x", { method: "POST", body: "{}" }));
      statuses.push(res.status);
      if (res.status === 200) await res.text();
    }
    expect(statuses).toEqual([200, 200, 200, 200, 429]);
  });

  it("regenerate and card answer 429 once their bucket is empty", async () => {
    await build({ storeIds: [h.storeIds[0]] });
    const ed = await editionOf(h.storeIds[0]);
    const c = ctx(h.workspaceId, "10.5.5.5");
    for (let i = 0; i < 10; i++) await limitSpend(c, "regenerate");
    const regen = await regenerateRoute(cookieReq(h.workspaceId, "/x", { method: "POST", body: "{}" }), args({ id: ed.id, itemId: ed.items[0].id }));
    expect(regen.status).toBe(429);
    for (let i = 0; i < 10; i++) await limitSpend(c, "card");
    const card = await cardRoute(cookieReq(h.workspaceId), args({ id: ed.id }));
    expect(card.status).toBe(429);
  });

  it("does not charge the card bucket for a card that is already written", async () => {
    await build({ storeIds: [h.storeIds[0]] });
    const ed = await editionOf(h.storeIds[0]);
    expect((await cardRoute(cookieReq(h.workspaceId), args({ id: ed.id }))).status).toBe(200);
    for (let i = 0; i < 20; i++) expect((await cardRoute(cookieReq(h.workspaceId), args({ id: ed.id }))).status).toBe(200);
  });

  it("item edit answers 429 once the edit bucket is empty, but approve is free", async () => {
    await build({ storeIds: [h.storeIds[0]] });
    const ed = await editionOf(h.storeIds[0]);
    for (let i = 0; i < 30; i++) await limitSpend(ctx(h.workspaceId, "10.5.5.5"), "edit");
    const call = (body: unknown, version: number) =>
      patchItem(
        new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", "if-match": String(version), cookie: `le_ws=${h.workspaceId}`, "cf-connecting-ip": "10.5.5.5" } }),
        args({ id: ed.id, itemId: ed.items[0].id }),
      );
    expect((await call({ action: "edit", patch: { name: "Cardamom Morning Bun" } }, 0)).status).toBe(429);
    expect((await call({ action: "approve" }, 0)).status).toBe(200);
  });
});

describe("M9 a card token is set-if-absent", () => {
  it("returns one token when two first requests race, and that token resolves", async () => {
    await build({ storeIds: [h.storeIds[0]] });
    const ed: Edition = await editionOf(h.storeIds[0]);
    const [x, y] = await Promise.all([getOrCreateCard(h.deps, h.workspaceId, ed.id), getOrCreateCard(h.deps, h.workspaceId, ed.id)]);
    expect(x.token).toBe(y.token);
    expect((await h.repo.getStaffCardByToken(x.token))?.editionId).toBe(ed.id);
  });

  it("keeps the share token when a changed edition's card is rewritten", async () => {
    await build({ storeIds: [h.storeIds[0]] });
    const ed = await editionOf(h.storeIds[0]);
    const first = await getOrCreateCard(h.deps, h.workspaceId, ed.id);
    await build({ storeIds: [h.storeIds[0]] }); // rebuild blanks the card
    expect((await h.repo.getStaffCardByEdition(ed.id))!.lines).toEqual([]);
    const again = await getOrCreateCard(h.deps, h.workspaceId, ed.id);
    expect(again.token).toBe(first.token);
    expect(again.lines.length).toBeGreaterThan(0);
  });

  it("will not write a card for an edition that is still drafting", async () => {
    await build({ storeIds: [h.storeIds[0]] });
    const ed = await editionOf(h.storeIds[0]);
    await h.repo.setEditionStatus(ed.id, "drafting");
    await expect(getOrCreateCard(h.deps, h.workspaceId, ed.id)).rejects.toMatchObject({ code: "edition_drafting" });
  });
});
