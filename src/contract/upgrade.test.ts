import { describe, expect, it } from "vitest";
import {
  AgentEvent, BrandVoiceResponse, Edition, EditionItem, EvalResult, GuardrailResult, ItemAction, ItemPatchHeaders, JobMode, JobResultsBody, JobRun,
  LimitsResponse, MenuItem, PendingJobsResponse, ProofResponse, StaffCard, formatIfMatch, parseIfMatch, routes,
} from "@/contract";
import {
  mockBrandVoice, mockBuildEvents, mockCards, mockEditions, mockEval, mockJobRuns, mockLimits, mockMenu, mockProof,
  mockRegenerateEvents, mockReviewEvents,
} from "@/mocks";

async function collect(gen: AsyncIterable<unknown>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(AgentEvent.parse(e));
  return out;
}

describe("T1 upgrade contract: schemas parse the mocks", () => {
  it("the build sequence carries step_metrics for every role it uses, plus progress", async () => {
    const events = await collect(mockBuildEvents(["store_williamsburg", "store_harlem"]));
    const metrics = events.filter((e) => e.type === "step_metrics");
    const roles = new Set(metrics.map((m) => m.role));
    expect(roles).toEqual(new Set(["agent", "embed", "copy", "check"]));
    // Which Nemotron did what: agent on Super-VL, copy and check on Lightning, embeddings on Qwen.
    expect(new Set(metrics.filter((m) => m.role === "agent").map((m) => m.model))).toEqual(new Set(["nvidia/Nemotron-3.5-Super-VL"]));
    expect(new Set(metrics.filter((m) => m.role === "copy").map((m) => m.model))).toEqual(new Set(["nvidia/Nemotron-3_5-Lightning"]));
    expect(new Set(metrics.filter((m) => m.role === "embed").map((m) => m.model))).toEqual(new Set(["Qwen/Qwen3-Embedding-8B"]));
    for (const m of metrics) {
      expect(m.cachedTokens).toBeLessThanOrEqual(m.promptTokens);
      expect(m.usd).toBeGreaterThan(0);
      expect(m.ms).toBeGreaterThan(0);
      expect(m.storeId).toBeTruthy();
    }
    expect(metrics.some((m) => m.cachedTokens > 0)).toBe(true);
    expect(events.filter((e) => e.type === "progress").map((e) => (e.type === "progress" ? [e.done, e.total] : []))).toEqual([[1, 2], [2, 2]]);
    // Metrics are deterministic so recordings and screenshots are stable.
    expect(JSON.stringify(await collect(mockBuildEvents(["store_harlem"])))).toBe(JSON.stringify(await collect(mockBuildEvents(["store_harlem"]))));
  });

  it("a build never ships approved or certified drafts", async () => {
    const drafted = (await collect(mockBuildEvents(["store_west-village"], { force: true }))).flatMap((e) => (e.type === "item_drafted" ? [e.item] : []));
    expect(drafted).toHaveLength(4);
    for (const i of drafted) {
      expect(i.status).not.toBe("approved");
      expect(i.guardrail.checkedBy).toBe("live");
      expect(i.guardrail.certifiedAt).toBeUndefined();
    }
  });

  it("a build skips stores that have approvals unless forced", async () => {
    const approved = new Set(["store_harlem"]);
    const skipped = await collect(mockBuildEvents(["store_harlem"], { approvedStoreIds: approved }));
    expect(skipped.find((e) => e.type === "error")).toMatchObject({ code: "has_approvals", storeId: "store_harlem" });
    expect(skipped.some((e) => e.type === "store_done")).toBe(false);
    const forced = await collect(mockBuildEvents(["store_harlem"], { approvedStoreIds: approved, force: true }));
    expect(forced.some((e) => e.type === "store_done")).toBe(true);
  });

  it("the review pass emits one Ultra call and one verdict per store, with exactly one needs_change that clashes", async () => {
    const events = await collect(mockReviewEvents(mockEditions));
    const ultra = events.filter((e) => e.type === "step_metrics");
    expect(ultra).toHaveLength(1);
    expect(ultra[0]).toMatchObject({ role: "review", model: "nvidia/Nemotron-3-Ultra-550b-a55b" });
    const reviews = events.flatMap((e) => (e.type === "review" ? [e] : []));
    expect(reviews).toHaveLength(8);
    const bad = reviews.filter((r) => r.verdict === "needs_change");
    expect(bad).toHaveLength(1);
    expect(bad[0].clashWith).toEqual(["store_williamsburg"]);
    expect(bad[0].hint).toBeTruthy();
    expect(reviews.filter((r) => r.verdict === "approve").every((r) => r.clashWith.length === 0 && r.hint === null)).toBe(true);
    expect(events.at(-1)?.type).toBe("run_done");
  });

  it("regenerate carries copy and check metrics", async () => {
    const regen = await collect(mockRegenerateEvents(mockEditions[0], mockEditions[0].items[0].id, "more citrus"));
    expect(regen.filter((e) => e.type === "step_metrics").map((e) => (e.type === "step_metrics" ? e.role : ""))).toEqual(["copy", "check"]);
  });

  it("editions, items, cards and the menu carry the new fields", () => {
    mockEditions.forEach((e) => Edition.parse(e));
    mockCards.forEach((c) => StaffCard.parse(c));
    mockMenu.forEach((m) => MenuItem.parse(m));
    expect(mockMenu.filter((m) => m.seen === true && m.priceLegible === false)).toHaveLength(1);
    expect(mockMenu.filter((m) => m.priceLegible !== false).every((m) => m.seen === true)).toBe(true);
    expect(mockEditions.every((e) => e.review?.reviewedBy === "nvidia/Nemotron-3-Ultra-550b-a55b")).toBe(true);
    const events = mockEditions.flatMap((e) => e.items.filter((i) => i.kind === "event"));
    for (const ev of events) {
      if (ev.kind !== "event") continue;
      expect(ev.tieIn).toMatchObject({ venue: expect.any(String), date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), triage: { reason: expect.any(String) } });
    }
    expect(events.filter((e) => e.kind === "event" && e.tieIn?.triage?.kept === false)).toHaveLength(1);
    const items = mockEditions.flatMap((e) => e.items);
    expect(items.every((i) => i.guardrail.checkedBy !== undefined)).toBe(true);
    const certified = items.filter((i) => i.guardrail.checkedBy === "nemo-guardrails@nebius-job");
    expect(certified.length).toBeGreaterThan(0);
    expect(certified.every((i) => i.guardrail.certifiedAt && i.guardrail.jobId && i.guardrail.status === "passed")).toBe(true);
    expect(items.some((i) => i.verification?.lift === "recomputed")).toBe(true);
    expect(items.every((i) => i.verification?.lift !== "mismatch" && i.verification?.entities !== "missing")).toBe(true);
  });

  it("has one JobRun per mode and a self-consistent EvalResult", () => {
    mockJobRuns.forEach((j) => JobRun.parse(j));
    expect(mockJobRuns.map((j) => j.mode).sort()).toEqual([...JobMode.options].sort());
    EvalResult.parse(mockEval);
    const blockRows = mockEval.rows.filter((r) => r.expected === "block");
    expect(mockEval.cases).toBe(blockRows.length);
    expect(mockEval.caught).toBe(blockRows.filter((r) => r.got === "block").length);
    expect(mockEval.benign).toBe(mockEval.rows.length - blockRows.length);
    expect(mockEval.falsePositives).toBe(mockEval.rows.filter((r) => r.expected === "pass" && r.got === "block").length);
    expect(mockEval.catchRate).toBeCloseTo(mockEval.caught / mockEval.cases, 3);
    expect([mockEval.cases, mockEval.benign]).toEqual([40, 10]);
  });

  it("proof, limits and brand-voice payloads parse their routes", () => {
    expect(routes.getProof.response.parse(mockProof)).toEqual(mockProof);
    ProofResponse.parse(mockProof);
    expect(mockProof.cachedRatio).toBeGreaterThan(0.3);
    expect(mockProof.spendPerEditionUsd).toBeGreaterThan(0.005);
    expect(mockProof.spendPerEditionUsd).toBeLessThan(0.05);
    LimitsResponse.parse(mockLimits);
    BrandVoiceResponse.parse(mockBrandVoice);
    expect(routes.getLimits.response.safeParse(mockLimits).success).toBe(true);
    expect(routes.generateBrandVoice.response.safeParse(mockBrandVoice).success).toBe(true);
    expect(routes.getProof.response.safeParse({ ...mockProof, eval: null }).success).toBe(true);
  });
});

describe("T1 upgrade contract: backward compatibility and request shapes", () => {
  it("rows written before the upgrade still parse", () => {
    expect(GuardrailResult.safeParse({ status: "passed", reasons: [] }).success).toBe(true);
    const oldEdition = structuredClone(mockEditions[0]) as Record<string, unknown> & { items: Record<string, unknown>[] };
    delete oldEdition.review;
    for (const item of oldEdition.items) {
      delete item.verification;
      item.guardrail = { status: (item.guardrail as { status: string }).status, reasons: [] };
    }
    expect(Edition.safeParse(oldEdition).success).toBe(true);
    const oldMenu: Record<string, unknown> = { ...mockMenu[0] };
    delete oldMenu.seen;
    delete oldMenu.priceLegible;
    expect(MenuItem.safeParse(oldMenu).success).toBe(true);
    const old = { id: "job_t", trigger: "cron", startedAt: "2026-11-02T00:00:00.000Z", finishedAt: null, storeIds: [], status: "running", nebiusJobId: null, note: "" };
    expect(JobRun.safeParse(old).success).toBe(true);
    const event = mockEditions[0].items.find((i) => i.kind === "event")!;
    if (event.kind !== "event") throw new Error("unreachable");
    expect(EditionItem.safeParse({ ...event, tieIn: { title: "t", url: "https://example.com", source: "tavily" } }).success).toBe(true);
    expect(EditionItem.safeParse({ ...event, tieIn: null }).success).toBe(true);
  });

  it("rejects malformed upgrade data", () => {
    expect(GuardrailResult.safeParse({ status: "passed", reasons: [], checkedBy: "someone" }).success).toBe(false);
    expect(AgentEvent.safeParse({ type: "step_metrics", role: "judge", model: "m", ms: 1, promptTokens: 1, cachedTokens: 0, completionTokens: 1, usd: 0 }).success).toBe(false);
    expect(AgentEvent.safeParse({ type: "step_metrics", role: "agent", model: "m", ms: -1, promptTokens: 1, cachedTokens: 0, completionTokens: 1, usd: 0 }).success).toBe(false);
    expect(AgentEvent.safeParse({ type: "review", storeId: "s", verdict: "maybe", reason: "r", clashWith: [], hint: null, reviewedBy: "m" }).success).toBe(false);
    expect(EvalResult.safeParse({ ...mockEval, catchRate: 1.5 }).success).toBe(false);
    expect(EditionItem.safeParse({ ...mockEditions[0].items[0], verification: { lift: "maybe", entities: "found" } }).success).toBe(false);
  });

  it("request shapes: signed job routes, review, brand voice, force, override, If-Match", () => {
    const sig = { "x-le-signature": "abc" };
    expect(routes.getPendingJobs.request.safeParse({ headers: {} }).success).toBe(false);
    expect(routes.getPendingJobs.request.safeParse({ headers: sig }).success).toBe(true);
    expect(routes.postJobResults.request.safeParse({ headers: sig, body: { results: [{ editionId: "e", itemId: "i", guardrail: { status: "passed", reasons: [], checkedBy: "nemo-guardrails@nebius-job", jobId: "j" } }] } }).success).toBe(true);
    expect(JobResultsBody.safeParse({ results: Array.from({ length: 501 }, () => ({ editionId: "e", itemId: "i", guardrail: { status: "passed", reasons: [] } })) }).success).toBe(false);
    expect(routes.postJobEval.request.safeParse({ headers: sig, body: mockEval }).success).toBe(true);
    expect(routes.reviewEditions.request.safeParse({ body: { weekOf: "2026-10-26" } }).success).toBe(true);
    expect(routes.reviewEditions.request.safeParse({ body: { weekOf: "next week" } }).success).toBe(false);
    expect(routes.buildEditions.request.safeParse({ body: { storeIds: ["a"], force: true } }).success).toBe(true);
    expect(ItemAction.safeParse({ action: "approve", override: true }).success).toBe(true);
    expect(routes.patchItem.request.safeParse({ params: { id: "e", itemId: "i" }, body: { action: "approve" } }).success).toBe(true);
    expect(ItemPatchHeaders.safeParse({ "if-match": formatIfMatch(3) }).success).toBe(true);
    expect(ItemPatchHeaders.safeParse({}).success).toBe(false);
    expect(PendingJobsResponse.safeParse({ items: [{ editionId: "e", itemId: "i", kind: "card", text: "t", brandVoice: ["Plain."] }] }).success).toBe(true);
  });

  it("formats and parses If-Match values", () => {
    expect(formatIfMatch(4)).toBe("4");
    expect(parseIfMatch("4")).toBe(4);
    expect(parseIfMatch('"4"')).toBe(4);
    expect(parseIfMatch('W/"4"')).toBe(4);
    expect(parseIfMatch("")).toBeNull();
    expect(parseIfMatch("abc")).toBeNull();
    expect(parseIfMatch("-1")).toBeNull();
    expect(parseIfMatch(null)).toBeNull();
  });
});
