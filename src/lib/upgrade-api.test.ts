import { describe, expect, it, vi } from "vitest";
import { createApiClient, consumeEvents } from "./api-client";
import { mockEditions, mockEval, mockProof } from "@/mocks";

describe("mock-mode api client: upgrade behaviour", () => {
  const fresh = () => createApiClient({ mode: "mock", mockDelayMs: 0, mockEventDelayMs: 0 });

  it("patchItem needs the item's version: 409 when stale, 428 when missing", async () => {
    const api = fresh();
    const ed = (await api.listEditions())[0];
    const special = ed.items.find((i) => i.kind === "special")!;
    await expect(api.patchItem(ed.id, special.id, { action: "reject" }, special.version + 5)).rejects.toMatchObject({ status: 409, code: "version_conflict" });
    await expect(api.patchItem(ed.id, special.id, { action: "reject" }, undefined as never)).rejects.toMatchObject({ status: 428, code: "version_required" });
    const rejected = await api.patchItem(ed.id, special.id, { action: "reject" }, special.version);
    expect(rejected.version).toBe(special.version + 1);
    await expect(api.patchItem(ed.id, special.id, { action: "reject" }, special.version)).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("unchecked items need override, flagged items never approve", async () => {
    const api = fresh();
    const lic = (await api.listEditions()).find((e) => e.storeId === "store_long-island-city")!;
    const unchecked = lic.items.find((i) => i.guardrail.status === "unchecked")!;
    await expect(api.patchItem(lic.id, unchecked.id, { action: "approve" }, unchecked.version)).rejects.toMatchObject({ status: 409, code: "guardrail_unchecked" });
    expect((await api.patchItem(lic.id, unchecked.id, { action: "approve", override: true }, unchecked.version)).status).toBe("approved");
    const astoria = (await api.listEditions()).find((e) => e.storeId === "store_astoria")!;
    const flagged = astoria.items.find((i) => i.status === "flagged")!;
    await expect(api.patchItem(astoria.id, flagged.id, { action: "approve", override: true }, flagged.version)).rejects.toMatchObject({ code: "guardrail_blocked" });
  });

  it("build skips stores with approvals unless forced", async () => {
    const api = fresh();
    const skipped = await consumeEvents(api.buildEditions({ storeIds: ["store_west-village"] }));
    expect(skipped.find((e) => e.type === "error")).toMatchObject({ code: "has_approvals" });
    const forced = await consumeEvents(api.buildEditions({ storeIds: ["store_west-village"], force: true }));
    expect(forced.some((e) => e.type === "store_done")).toBe(true);
  });

  it("reviews editions over a stream and stores the verdicts", async () => {
    const api = fresh();
    const events = await consumeEvents(api.reviewEditions());
    expect(events.filter((e) => e.type === "review")).toHaveLength(8);
    const harlem = (await api.listEditions()).find((e) => e.storeId === "store_harlem")!;
    expect(harlem.review).toMatchObject({ verdict: "needs_change", clashWith: ["store_williamsburg"] });
    expect((await consumeEvents(api.reviewEditions({ weekOf: "2026-01-05" }))).filter((e) => e.type === "review")).toHaveLength(0);
  });

  it("serves proof, limits and brand voice", async () => {
    const api = fresh();
    expect((await api.getProof()).jobRuns.map((j) => j.mode)).toEqual(["rebuild", "certify", "eval", "import"]);
    expect((await api.getLimits()).qlooCoverageGaps.length).toBeGreaterThan(0);
    const voice = await api.generateBrandVoice();
    expect(voice.lines.length).toBeLessThanOrEqual(3);
    expect(voice.sources.some((s) => s.source === "tavily")).toBe(true);
  });

  it("job routes: pending items, results flip approved blocked copy to flagged, eval lands in proof", async () => {
    const api = fresh();
    await expect(api.getPendingJobs("")).rejects.toMatchObject({ status: 401 });
    const { items } = await api.getPendingJobs("sig");
    expect(items.length).toBeGreaterThan(0);
    const approved = (await api.listEditions()).find((e) => e.storeId === "store_west-village")!;
    const target = approved.items.find((i) => i.status === "approved")!;
    const sent = await api.postJobResults("sig", { results: [
      { editionId: approved.id, itemId: target.id, guardrail: { status: "blocked", rail: "no-health-claims", reasons: ["Health claim."], checkedBy: "nemo-guardrails@nebius-job", jobId: "j1" } },
      { editionId: "ed_missing", itemId: "x", guardrail: { status: "passed", reasons: [] } },
    ] });
    expect(sent.updated).toBe(1);
    const after = (await api.getEdition(approved.id)).items.find((i) => i.id === target.id)!;
    expect(after.status).toBe("flagged");
    expect((await api.getPendingJobs("sig")).items.find((i) => i.itemId === target.id)).toBeUndefined();
    await api.postJobEval("sig", { ...mockEval, caught: 39, catchRate: 0.975 });
    expect((await api.getProof()).eval?.caught).toBe(39);
  });
});

describe("http-mode api client: upgrade routes", () => {
  it("sends If-Match with the item version and signs job routes", async () => {
    const seen: { url: string; method: string; headers: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string> });
      if (url.endsWith("/api/proof")) return Response.json(mockProof);
      if (url.endsWith("/api/jobs/pending")) return Response.json({ items: [] });
      return Response.json(mockEditions[0].items[0]);
    });
    const api = createApiClient({ mode: "app", baseUrl: "http://t.test", fetchImpl: fetchImpl as never });
    await api.patchItem("ed_1", "item_1", { action: "approve" }, 3);
    expect(seen[0]).toMatchObject({ method: "PATCH", url: "http://t.test/api/editions/ed_1/items/item_1" });
    expect(seen[0].headers["if-match"]).toBe("3");
    await api.getProof();
    await api.getPendingJobs("deadbeef");
    expect(seen[2].headers["x-le-signature"]).toBe("deadbeef");
    expect(seen[1].url).toBe("http://t.test/api/proof");
  });

  it("surfaces 428 version_required from the server", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "Send the item's version.", code: "version_required" }, { status: 428 }));
    const api = createApiClient({ mode: "app", fetchImpl: fetchImpl as never });
    await expect(api.patchItem("e", "i", { action: "approve" }, 0)).rejects.toMatchObject({ status: 428, code: "version_required" });
  });
});
