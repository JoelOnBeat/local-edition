import { describe, expect, it } from "vitest";
import { AgentEvent, Edition } from "@/contract";
import { UpstreamError } from "../http/errors";
import { buildEditions } from "./build";
import { findClashes, type StoreEdition } from "./clash";
import { defaultHintFor, hintKind } from "./review-hint";
import { REVIEW_FALLBACK_MODEL, REVIEW_MODEL } from "./ports";
import { regenerateItem } from "./regenerate";
import { REVIEW_MAX_TOKENS, REVIEW_REASONING, reviewEditions, toReviewFields } from "./review";
import { FIXTURE_REVIEWER } from "./review-fixture";
import { REVIEW_JSON_SCHEMA } from "./review-prompt";
import { readMetricsTotals } from "./stats";
import { WEEK_OF, call, collect, harness, scriptedChat, turn, type Harness } from "./test-utils";

type Step = Extract<AgentEvent, { type: "step_metrics" }>;
type Review = Extract<AgentEvent, { type: "review" }>;

async function built(opts: Parameters<typeof harness>[0] = {}) {
  const h = await harness({ storeCount: 2, ...opts });
  await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
  return h;
}

const approve = (storeId: string) => ({ storeId, verdict: "approve", reason: "Fits the voice and stands alone.", clashWith: [], hint: null });
const needsChange = (storeId: string, clashWith: string[]) => ({ storeId, verdict: "needs_change", reason: "Runs the same record fair as its neighbour.", clashWith, hint: "event: pick a different night than the record fair" });
const reply = (...reviews: object[]) => JSON.stringify({ reviews });

async function review(h: Harness, weekOf?: string) {
  return collect(reviewEditions({ workspaceId: h.workspaceId, weekOf }, h.deps));
}

describe("clashes found by code", () => {
  const entries = async (h: Harness): Promise<StoreEdition[]> => {
    const eds = await h.repo.listEditions({ storeIds: h.storeIds });
    return Promise.all(eds.map(async (edition) => ({ storeId: edition.storeId, storeName: (await h.repo.getStore(edition.storeId))!.name, edition })));
  };

  it("finds two stores on the same event listing, the same partner and a shared artist list", async () => {
    const h = await built({ qloo: { sharedPlaces: true } });
    const clashes = await findClashes(h.deps, await entries(h));
    const kinds = clashes.map((c) => c.kind);
    expect(kinds).toContain("same_event");
    expect(kinds).toContain("same_partner");
    expect(kinds).toContain("shared_artists");
    expect(clashes.find((c) => c.kind === "same_partner")!.detail).toContain("Greenlight Bookstore");
    // Exact matches are not reported a second time as near-identical copy.
    expect(clashes.filter((c) => c.kind === "similar_copy" && c.itemKind === "partner")).toHaveLength(0);
  });

  it("reports no shared partner when every store sees different places", async () => {
    const h = await built({ qloo: { sharedPlaces: false }, copy: (user) => JSON.stringify({ name: `Special ${user.length}`, description: "x".repeat(20) + user.length, staffLine: "y".repeat(20), brief: `brief ${user.length} ${Math.random()}`, mood: "calm", reason: "r".repeat(20), offerIdea: "o".repeat(20), title: "T".repeat(5), lines: [] }) });
    const clashes = await findClashes(h.deps, await entries(h));
    expect(clashes.some((c) => c.kind === "same_partner")).toBe(false);
  });

  it("reports near-identical copy by embedding similarity, and survives the embedding service failing", async () => {
    const h = await built({ qloo: { sharedPlaces: false } });
    const e = await entries(h);
    expect((await findClashes(h.deps, e)).some((c) => c.kind === "similar_copy" && c.itemKind === "special")).toBe(true);
    h.deps.tf = { ...h.deps.tf, embed: async () => { throw new Error("down"); } };
    const exactOnly = await findClashes(h.deps, e);
    expect(exactOnly.every((c) => c.kind !== "similar_copy")).toBe(true);
  });
});

describe("reviewEditions", () => {
  it("makes ONE Ultra call with strict JSON, then saves and streams a verdict per store", async () => {
    const h = await built();
    const [a, b] = h.storeIds;
    h.deps.chat = scriptedChat({ review: () => reply(needsChange(a, [b]), approve(b)) });
    const chat = h.deps.chat as ReturnType<typeof scriptedChat>;
    const events = await review(h);

    for (const e of events) expect(AgentEvent.safeParse(e).success, JSON.stringify(e)).toBe(true);
    expect(chat.reviewCalls).toBe(1);
    const req = chat.requests.find((r) => r.role === "review")!;
    expect(req).toMatchObject({ model: REVIEW_MODEL, maxTokens: REVIEW_MAX_TOKENS, reasoning: REVIEW_REASONING, responseFormat: { name: "portfolio_review", schema: REVIEW_JSON_SCHEMA } });
    // Static head first, the week's data last.
    expect(String(req.messages[0].content).startsWith("Brand voice:")).toBe(true);
    expect(String(req.messages[1].content)).toContain("same_event (event)");
    expect(String(req.messages[1].content)).toContain(`Store ${a}`);
    expect(String(req.messages[0].content)).not.toContain(`Store ${a}`);

    expect(events[0]).toMatchObject({ type: "run_started", storeIds: [a, b] });
    expect(events.at(-1)).toMatchObject({ type: "run_done" });
    const reviews = events.filter((e): e is Review => e.type === "review");
    expect(reviews).toEqual([
      expect.objectContaining({ storeId: a, verdict: "needs_change", clashWith: [b], hint: expect.stringMatching(/^event:/), reviewedBy: REVIEW_MODEL }),
      expect.objectContaining({ storeId: b, verdict: "approve", clashWith: [], hint: null, reviewedBy: REVIEW_MODEL }),
    ]);
    const steps = events.filter((e): e is Step => e.type === "step_metrics");
    expect(steps.filter((s) => s.role === "review")).toHaveLength(1);
    expect(steps.find((s) => s.role === "review")).toMatchObject({ model: REVIEW_MODEL, tool: "portfolio_review" });
    expect(steps.some((s) => s.role === "embed" && s.tool === "review_clashes")).toBe(true);

    const saved = await h.repo.getEdition((await h.repo.getEditionForWeek(a, WEEK_OF))!.id);
    expect(Edition.safeParse(saved).success).toBe(true);
    expect(saved!.review).toMatchObject({ verdict: "needs_change", clashWith: [b], reviewedBy: REVIEW_MODEL, at: "2026-10-28T02:00:00.000Z" });
    expect(hintKind(saved!.review!.hint)).toBe("event");
    expect((await readMetricsTotals(h.repo)).byRole.review.calls).toBe(1);
  });

  it("cleans the model's verdicts: unknown ids dropped, approvals carry no hint or clash, long text clipped", () => {
    const known = new Set(["s1", "s2"]);
    expect(toReviewFields({ storeId: "s1", verdict: "approve", reason: "ok", clashWith: ["s2"], hint: "partner: swap" }, "m", known)).toEqual({ verdict: "approve", reason: "ok", clashWith: [], hint: null, reviewedBy: "m" });
    const f = toReviewFields({ storeId: "s1", verdict: "needs_change", reason: "r".repeat(900), clashWith: ["s2", "s2", "s1", "ghost"], hint: "  " }, "m", known);
    expect(f.reason).toHaveLength(600);
    expect(f.clashWith).toEqual(["s2"]);
    expect(f.hint).toBeNull();
  });

  it("falls back to Super VL, says so in reviewedBy, when Ultra errors or returns bad JSON", async () => {
    for (const first of [new UpstreamError("timeout", "tokenfactory", "slow"), "not json at all"]) {
      const h = await built();
      const [a, b] = h.storeIds;
      const models: string[] = [];
      h.deps.chat = scriptedChat({ review: (req, n) => { models.push(req.model); return n === 0 ? (first instanceof Error ? first : first) : reply(approve(a), approve(b)); } });
      const events = await review(h);
      expect(models).toEqual([REVIEW_MODEL, REVIEW_FALLBACK_MODEL]);
      expect(events.find((e) => e.type === "error")).toMatchObject({ code: "reviewer_fallback" });
      const reviews = events.filter((e): e is Review => e.type === "review");
      expect(reviews).toHaveLength(2);
      expect(reviews.every((r) => r.reviewedBy === REVIEW_FALLBACK_MODEL)).toBe(true);
      expect((await h.repo.getEditionForWeek(a, WEEK_OF))!.review!.reviewedBy).toBe(REVIEW_FALLBACK_MODEL);
    }
  });

  it("reports review_failed and saves nothing when both reviewers fail", async () => {
    const h = await built();
    h.deps.chat = scriptedChat({ review: () => new UpstreamError("upstream_5xx", "tokenfactory", "down") });
    const events = await review(h);
    expect(events.map((e) => (e.type === "error" ? e.code : e.type))).toContain("review_failed");
    expect(events.some((e) => e.type === "review" || e.type === "run_done")).toBe(false);
    expect((await h.repo.getEditionForWeek(h.storeIds[0], WEEK_OF))!.review ?? null).toBeNull();
  });

  it("stops on the spend cap without falling back", async () => {
    const h = await built();
    h.deps.chat = scriptedChat({ review: () => new UpstreamError("spend_cap", "tokenfactory", "cap") });
    const events = await review(h);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "spend_cap" });
    expect((h.deps.chat as ReturnType<typeof scriptedChat>).reviewCalls).toBe(1);
  });

  it("flags a store the reviewer skipped and ignores a verdict for a store that is not in the week", async () => {
    const h = await built();
    h.deps.chat = scriptedChat({ review: () => reply(approve(h.storeIds[0]), approve("store_ghost")) });
    const events = await review(h);
    expect(events.filter((e) => e.type === "review")).toHaveLength(1);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "review_missing", storeId: h.storeIds[1] });
  });

  it("does not save a verdict for an edition that changed while it was being reviewed", async () => {
    const h = await built();
    const [a, b] = h.storeIds;
    const inner = scriptedChat({ review: () => reply(approve(a), approve(b)) });
    h.deps.chat = {
      async complete(req) {
        // Head office approves an item while the reviewer is thinking.
        const ed = (await h.repo.getEditionForWeek(a, WEEK_OF))!;
        await h.repo.updateEdition(ed.id, (cur) => ({ ...cur, items: cur.items.map((i, n) => (n === 0 ? { ...i, status: "approved" as const } : i)) }));
        return inner.complete(req);
      },
    };
    const events = await review(h);
    expect(events.filter((e) => e.type === "review").map((e) => (e.type === "review" ? e.storeId : ""))).toEqual([b]);
    expect(events.find((e) => e.type === "error" && e.code === "review_stale")).toMatchObject({ storeId: a });
    expect((await h.repo.getEditionForWeek(a, WEEK_OF))!.review ?? null).toBeNull();
  });

  it("answers no_editions when nothing is built, and reviews only the asked week", async () => {
    const empty = await harness({ storeCount: 2 });
    expect((await review(empty))[0]).toMatchObject({ type: "error", code: "no_editions" });
    const h = await built();
    expect((await review(h, "2026-11-02"))[0]).toMatchObject({ type: "error", code: "no_editions" });
    expect((await collect(reviewEditions({ workspaceId: "ws_missing" }, h.deps)))[0]).toMatchObject({ code: "workspace_not_found" });
  });

  it("does not review an edition that is still drafting", async () => {
    const h = await built();
    const ed = (await h.repo.getEditionForWeek(h.storeIds[1], WEEK_OF))!;
    await h.repo.updateEdition(ed.id, (cur) => ({ ...cur, status: "drafting" }));
    h.deps.chat = scriptedChat({ review: () => reply(approve(h.storeIds[0])) });
    const events = await review(h);
    expect(events[0]).toMatchObject({ type: "run_started", storeIds: [h.storeIds[0]] });
  });
});

describe("a needs_change hint feeds regenerate", () => {
  it("reads the kind from the hint", () => {
    expect(hintKind("Partner: pick somewhere quieter")).toBe("partner");
    expect(hintKind("swap it out")).toBeNull();
    expect(hintKind(null)).toBeNull();
    const base = { review: { verdict: "needs_change" as const, reason: "r", clashWith: [], hint: "partner: quieter", reviewedBy: "m", at: "2026-10-28T02:00:00.000Z" } };
    expect(defaultHintFor(base, "partner")).toBe("partner: quieter");
    expect(defaultHintFor(base, "event")).toBeUndefined();
    expect(defaultHintFor({ review: { ...base.review, verdict: "approve" } }, "partner")).toBeUndefined();
    expect(defaultHintFor({ review: null }, "partner")).toBeUndefined();
    expect(defaultHintFor({ review: { ...base.review, hint: "no kind named" } }, "event")).toBe("no kind named");
  });

  it("uses the reviewer's hint when head office gives none, and clears the stale verdict afterwards", async () => {
    const h = await built({ storeCount: 1 });
    const ed = (await h.repo.getEditionForWeek(h.storeIds[0], WEEK_OF))!;
    await h.repo.updateEdition(ed.id, (cur) => ({ ...cur, review: { verdict: "needs_change", reason: "Same partner as a neighbour.", clashWith: [], hint: "partner: choose a different neighbour", reviewedBy: REVIEW_MODEL, at: "2026-10-28T02:00:00.000Z" } }));
    const partner = ed.items.find((i) => i.kind === "partner")!;
    const chat = scriptedChat({ agent: [turn(call("places_near")), turn(call("submit_candidates", { partner: { placeRef: "p2" } }))] });
    h.deps.chat = chat;
    await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: partner.id }, h.deps));
    const prompt = chat.requests.find((r) => r.role === "agent")!.messages.find((m) => m.role === "user")!.content;
    expect(prompt).toContain('Head office asks: "partner: choose a different neighbour"');
    expect((await h.repo.getEdition(ed.id))!.review).toBeNull();
  });

  it("an explicit hint wins, and a hint about another kind is not applied", async () => {
    const h = await built({ storeCount: 1 });
    const ed = (await h.repo.getEditionForWeek(h.storeIds[0], WEEK_OF))!;
    await h.repo.updateEdition(ed.id, (cur) => ({ ...cur, review: { verdict: "needs_change", reason: "r", clashWith: [], hint: "event: another night", reviewedBy: REVIEW_MODEL, at: "2026-10-28T02:00:00.000Z" } }));
    const partner = ed.items.find((i) => i.kind === "partner")!;
    const script = () => scriptedChat({ agent: [turn(call("places_near")), turn(call("submit_candidates", { partner: { placeRef: "p2" } }))] });
    let chat = script();
    h.deps.chat = chat;
    await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: partner.id }, h.deps));
    expect(JSON.stringify(chat.requests[0].messages)).not.toContain("another night");
    // Regenerating again with an explicit hint.
    chat = script();
    h.deps.chat = chat;
    const now = (await h.repo.getEdition(ed.id))!.items.find((i) => i.kind === "partner")!;
    await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: now.id, hint: "somewhere with parking" }, h.deps));
    expect(JSON.stringify(chat.requests[0].messages)).toContain("somewhere with parking");
  });
});

describe("fixture mode (no model judgment)", () => {
  it("answers from the clashes code found, labelled, when the sample model returns no verdicts", async () => {
    const h = await built({ qloo: { sharedPlaces: true } });
    h.deps.seedBadItem = true;
    h.deps.chat = scriptedChat({ review: () => reply({ storeId: "string", verdict: "approve", reason: "string", clashWith: [], hint: null }) });
    const events = await review(h);
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    const reviews = events.filter((e): e is Review => e.type === "review");
    expect(reviews).toHaveLength(2);
    for (const r of reviews) expect(r).toMatchObject({ verdict: "needs_change", reviewedBy: FIXTURE_REVIEWER, hint: expect.stringMatching(/^(special|sound|partner|event):/) });
    expect(reviews[0].clashWith).toEqual([h.storeIds[1]]);
  });

  it("without the fixture switch, an empty answer is still a per-store review_missing error", async () => {
    const h = await built({ qloo: { sharedPlaces: true } });
    h.deps.chat = scriptedChat({ review: () => reply() });
    const events = await review(h);
    expect(events.filter((e) => e.type === "error")).toHaveLength(2);
    expect(events.some((e) => e.type === "review")).toBe(false);
  });
});
