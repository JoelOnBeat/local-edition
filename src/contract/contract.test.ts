import { describe, expect, it } from "vitest";
import {
  AgentEvent, BlockProfile, Chain, CompareResult, Edition, EditionItem, JobRun, MenuItem, ProviderStatus,
  StaffCard, Store, WorkspaceBundle, PublicStaffCard, routeTable, routes, ItemAction,
} from "@/contract";
import {
  getMockProfile, mockBuildEvents, mockCards, mockCompare, mockEditions, mockJobRun, mockPublicCard,
  mockRegenerateEvents, mockStatus, mockWorkspaceBundle, mockProfiles,
} from "@/mocks";
import { SAMPLE_CHAIN, SAMPLE_MENU, SAMPLE_STORES } from "@/server/sample/chain";

describe("T1 contract: sample chain and mocks parse", () => {
  it("sample chain, stores and menu parse and match the brief", () => {
    expect(Chain.parse(SAMPLE_CHAIN).isSample).toBe(true);
    expect(SAMPLE_CHAIN.name).toBe("Kettle & Kiln (sample chain)");
    expect(SAMPLE_STORES.map((s) => Store.parse(s).colorIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(SAMPLE_MENU).toHaveLength(22);
    SAMPLE_MENU.forEach((m) => MenuItem.parse(m));
    expect(SAMPLE_CHAIN.brandVoice.join(" ")).not.toContain("!");
    expect(new Set(SAMPLE_MENU.map((m) => m.id)).size).toBe(22);
  });

  it("workspace bundle, profiles, editions, cards, job and status parse", () => {
    WorkspaceBundle.parse(mockWorkspaceBundle());
    mockProfiles.forEach((p) => BlockProfile.parse(p));
    mockEditions.forEach((e) => Edition.parse(e));
    mockCards.forEach((c) => StaffCard.parse(c));
    JobRun.parse(mockJobRun);
    ProviderStatus.parse(mockStatus);
    expect(mockEditions).toHaveLength(8);
  });

  it("every edition has all four item kinds and every item cites existing evidence", () => {
    for (const e of mockEditions) {
      expect(e.items.map((i) => i.kind).sort()).toEqual(["event", "partner", "sound", "special"]);
      const ids = new Set(e.evidence.map((x) => x.id));
      for (const item of e.items) {
        EditionItem.parse(item);
        expect(item.evidenceIds.length).toBeGreaterThan(0);
        item.evidenceIds.forEach((id) => expect(ids.has(id)).toBe(true));
      }
    }
  });

  it("copy has no exclamation marks and no health claims", () => {
    const text = JSON.stringify([mockEditions, mockCards]);
    expect(text).not.toMatch(/!/);
    expect(text).not.toMatch(/\b(healthy|detox|cures?|immune|antioxidants?)\b/i);
  });

  it("covers guardrail variety and never ships an unchecked item as approved", () => {
    const items = mockEditions.flatMap((e) => e.items);
    const statuses = new Set(items.map((i) => i.guardrail.status));
    expect(statuses).toEqual(new Set(["passed", "rewritten", "unchecked"]));
    expect(items.filter((i) => i.guardrail.status === "unchecked").every((i) => i.status !== "approved")).toBe(true);
  });

  it("block profiles are distinct and sorted by lift", () => {
    for (const p of mockProfiles) {
      expect(p.tags.length).toBeLessThanOrEqual(12);
      expect(p.tags.map((t) => t.lift)).toEqual([...p.tags.map((t) => t.lift)].sort((a, b) => b - a));
    }
    const tops = new Set(mockProfiles.map((p) => p.tags[0].name));
    expect(tops.size).toBe(8);
  });

  it("compare shares tags across two stores and parses", () => {
    const r = mockCompare("store_williamsburg", "store_harlem")!;
    CompareResult.parse(r.result);
    expect(r.result.shared.map((t) => t.name)).toContain("Specialty Coffee");
    expect(r.result.onlyA.length).toBeGreaterThan(0);
    expect(mockCompare("store_williamsburg", "nope")).toBeNull();
    expect(getMockProfile("nope")).toBeUndefined();
  });

  it("public card resolves by token", () => {
    const token = mockCards[0].token;
    PublicStaffCard.parse(mockPublicCard(token));
    expect(mockPublicCard("missing")).toBeNull();
  });

  it("partner places are invented and mock events parse in order", async () => {
    const events: AgentEvent[] = [];
    for await (const e of mockBuildEvents(["store_astoria", "store_harlem"])) events.push(AgentEvent.parse(e));
    expect(events[0].type).toBe("run_started");
    expect(events.at(-1)?.type).toBe("run_done");
    expect(events.filter((e) => e.type === "store_done")).toHaveLength(2);
    expect(events.filter((e) => e.type === "item_drafted")).toHaveLength(8);
    const regen: AgentEvent[] = [];
    for await (const e of mockRegenerateEvents(mockEditions[0], mockEditions[0].items[0].id, "more citrus")) regen.push(AgentEvent.parse(e));
    expect(regen.some((e) => e.type === "item_drafted")).toBe(true);
  });
});

describe("T1 contract: route table", () => {
  it("lists all 28 contract routes with unique method+path", () => {
    expect(routeTable).toHaveLength(28);
    expect(new Set(routeTable.map((r) => `${r.method} ${r.path}`)).size).toBe(28);
    expect(routeTable.filter((r) => r.sse).map((r) => r.id)).toEqual(["buildEditions", "regenerateItem", "reviewEditions"]);
  });

  it("validates request shapes", () => {
    expect(routes.searchAnchors.request.safeParse({ query: { q: "" } }).success).toBe(false);
    expect(routes.getEdition.request.safeParse({ params: { id: "ed_1" } }).success).toBe(true);
    expect(ItemAction.safeParse({ action: "edit", patch: {} }).success).toBe(false);
    expect(ItemAction.safeParse({ action: "edit", patch: { name: "New name" } }).success).toBe(true);
    expect(routes.readMenu.request.safeParse({ body: { image: new File(["x"], "m.gif", { type: "image/gif" }) } }).success).toBe(false);
    expect(routes.readMenu.request.safeParse({ body: { image: new File(["x"], "m.png", { type: "image/png" }) } }).success).toBe(true);
  });

  it("rejects an item with no evidence and a sound item with too few artists", () => {
    const sound = mockEditions[0].items.find((i) => i.kind === "sound")!;
    expect(EditionItem.safeParse({ ...sound, evidenceIds: [] }).success).toBe(false);
    expect(EditionItem.safeParse({ ...sound, artists: sound.artists.slice(0, 3) }).success).toBe(false);
  });

  it("route responses parse their mock payloads", () => {
    expect(routes.getStatus.response.safeParse(mockStatus).success).toBe(true);
    expect(routes.getLatestJob.response.safeParse(null).success).toBe(true);
    expect(routes.listEditions.response.safeParse(mockEditions).success).toBe(true);
  });
});
