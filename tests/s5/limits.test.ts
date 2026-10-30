import { beforeEach, describe, expect, it } from "vitest";
import type { Edition, EditionItem, WorkspaceBundle } from "@/contract";
import { GET as limitsGET } from "@/app/api/limits/route";
import { getWorkspace } from "@/server/handlers/workspace";
import { ensureDemoWorkspace } from "@/server/session";
import { LimitsBody } from "@/server/handlers/limits";
import { LEDGER_KEYS } from "@/server/handlers/proof-ledger";
import { recordDropped, recordEditions, recordStep, recordTavily } from "./ledger-helpers";
import { mockEval } from "@/mocks/upgrade-data";
import type { Repo } from "@/server/store";
import { cleanEdition, cookieOf, freshApp, req } from "../e/helpers";

let repo: Repo;
beforeEach(() => { repo = freshApp(); });

let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter++ % 200) + 1}`;
async function visit() {
  const res = await getWorkspace(req("/api/workspace", { ip: nextIp() }));
  return { cookie: cookieOf(res), bundle: (await res.json()) as WorkspaceBundle };
}
const limits = async (cookie?: string, ip = nextIp()) => {
  const res = await limitsGET(req("/api/limits", { cookie, ip }));
  return { res, body: LimitsBody.parse(await res.clone().json()) };
};

/** A clean edition for one of the visitor's stores. */
function editionFor(storeId: string, id: string, mutate: (items: EditionItem[]) => EditionItem[] = (i) => i): Edition {
  const e = cleanEdition("store_williamsburg", id);
  return { ...e, storeId, items: mutate(e.items) };
}

describe("GET /api/limits", () => {
  it("for a visitor with no workspace: counters are zero, rates are null, no workspace is created, no cookie is set", async () => {
    const { res, body } = await limits();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(body).toMatchObject({ droppedForEvidence: 0, guardrailBlocks: 0, falsePositiveRate: null, costPerEditionUsd: null, tavilyCreditsUsed: 0 });
    expect(body.qlooCoverageGaps).toEqual([]); // no demo workspace in this store: nothing to report on
    expect(await repo.getWorkspace("demo")).toBeNull();
  });

  it("without a cookie it reads the demo workspace; with a cookie it reads the visitor's own", async () => {
    await ensureDemoWorkspace(repo);
    const anon = await limits();
    expect(anon.res.headers.get("set-cookie")).toBeNull();
    expect(anon.body.qlooCoverageGaps).toHaveLength(8);
    expect(anon.body.qlooCoverageGaps[0]).toMatch(/no edition has been built yet/);
    const mine = await visit();
    const own = await limits(mine.cookie);
    expect(own.res.headers.get("set-cookie")).toBeNull();
  });

  it("reports the Tavily total and daily slice, Qloo's calls against 2,000 and 200, the rate limits and the visitor budgets from the server", async () => {
    await recordTavily(repo, 3);
    const { body } = await limits();
    expect(body.tavily).toEqual({ used: 3, cap: 80, dailyUsed: 3, dailyCap: 10 });
    expect(body.qloo).toMatchObject({ cap: 2000, dailyCap: 200 });
    expect(body.qloo!.used).toBeGreaterThanOrEqual(0);
    expect(body.rateLimits.map((r) => r.action)).toEqual(expect.arrayContaining(["Build editions", "Search Qloo brands", "Read a menu photo"]));
    expect(body.rateLimits.find((r) => r.action === "Build editions")).toEqual({ action: "Build editions", workspace: "4, then 1 a minute", ip: "12, then 3 a minute" });
    expect(body.visitorBudgets).toEqual({ workspaceUsd: 0.4, networkDailyUsd: 0.8, demoFloorUsd: 1.5 });
  });

  it("reads the counters and rates that were recorded", async () => {
    const { cookie } = await visit();
    await recordDropped(repo, 3);
    await recordDropped(repo, 1);
    await recordTavily(repo, 2);
    await recordStep(repo, 1000, 0, 100, 0.02);
    await recordEditions(repo, 4);
    await repo.cachePut(LEDGER_KEYS.evalLatest, mockEval, 3600);
    const { body } = await limits(cookie);
    expect(body.droppedForEvidence).toBe(4);
    expect(body.tavilyCreditsUsed).toBe(2);
    expect(body.costPerEditionUsd).toBeCloseTo(0.005, 10);
    expect(body.falsePositiveRate).toBe(mockEval.falsePositiveRate);
  });

  it("reports the app's GLOBAL Tavily counter: every visitor sees the same number, whoever spent the credits", async () => {
    const a = await visit();
    const b = await visit();
    await recordTavily(repo, 3);
    expect((await limits(a.cookie)).body.tavilyCreditsUsed).toBe(3);
    expect((await limits(b.cookie)).body.tavilyCreditsUsed).toBe(3);
    await recordTavily(repo, 2);
    expect((await limits(a.cookie)).body.tavilyCreditsUsed).toBe(5);
  });

  it("counts blocked items in the visitor's own editions only", async () => {
    const a = await visit();
    const b = await visit();
    const blocked = (items: EditionItem[]) =>
      items.map((i, n) => (n < 2 ? ({ ...i, status: "flagged", guardrail: { status: "blocked", reasons: ["health claim"], rail: "health" } } as EditionItem) : i));
    await repo.putEdition(editionFor(a.bundle.stores[0].id, "ed_a_1", blocked));
    expect((await limits(a.cookie)).body.guardrailBlocks).toBe(2);
    expect((await limits(b.cookie)).body.guardrailBlocks).toBe(0);
  });

  it("names a store whose edition has no sound brief, and reports sample Qloo evidence", async () => {
    const a = await visit();
    const [s0, s1] = a.bundle.stores;
    await repo.putEdition(editionFor(s0.id, "ed_a_full"));
    await repo.putEdition(editionFor(s1.id, "ed_a_nosound", (items) => items.filter((i) => i.kind !== "sound")));
    const { body } = await limits(a.cookie);
    expect(body.qlooCoverageGaps).toContain(`${s1.name}: this week's edition has no sound brief; no candidate backed by Qloo evidence was kept.`);
    expect(body.qlooCoverageGaps.some((g) => g.startsWith(`${s0.name}:`) && g.includes("has no"))).toBe(false);
    const fixtureLine = body.qlooCoverageGaps.find((g) => /Qloo evidence records .* are sample data/.test(g));
    if (fixtureLine) expect(fixtureLine).toMatch(/^\d+ of \d+ Qloo evidence records/);
    expect(body.qlooCoverageGaps.filter((g) => g.includes("no edition has been built yet"))).toHaveLength(6);
    for (const g of body.qlooCoverageGaps) expect(g.length).toBeLessThanOrEqual(240);
  });

  it("does not call an edition that is still drafting a gap", async () => {
    const a = await visit();
    const e = editionFor(a.bundle.stores[0].id, "ed_a_drafting", () => []);
    await repo.putEdition({ ...e, status: "drafting" });
    const { body } = await limits(a.cookie);
    expect(body.qlooCoverageGaps.some((g) => g.startsWith(`${a.bundle.stores[0].name}:`))).toBe(false);
  });

  it("ignores a corrupt counter row instead of failing", async () => {
    const { cookie } = await visit();
    await repo.cachePut("stats:verify:v1", "lots", 3600);
    await repo.cachePut("tv:credits:global:v1", { total: -5, day: "x", dayUsed: "lots" }, 3600);
    const { res, body } = await limits(cookie);
    expect(res.status).toBe(200);
    expect(body.tavily.used).toBe(0);
    expect(body.droppedForEvidence).toBe(0);
    expect(body.tavilyCreditsUsed).toBe(0);
  });

  it("rate limits an address with { error, code }", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 62; i++) last = await limitsGET(req("/api/limits", { ip: "203.0.113.90" }));
    expect(last!.status).toBe(429);
    expect(await last!.json()).toMatchObject({ code: "rate_limited" });
  });
});
