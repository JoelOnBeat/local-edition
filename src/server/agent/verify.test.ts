import { describe, expect, it } from "vitest";
import { EditionItem } from "@/contract";
import { buildEditions } from "./build";
import { ToolMemory } from "./memory";
import type { Candidate } from "./plan";
import { readVerifierCounts, droppedForEvidence } from "./stats";
import { WEEK_OF, collect, harness } from "./test-utils";
import { LIFT_TOLERANCE, payloadFrom, recomputeLift, seededBadCandidate, verifyCandidate } from "./verify";
import { makeEvidence } from "./util";

const TAG = "urn:tag:specialty_dish:place:cardamom_bun";
const baseline = [{ tagId: TAG, affinity: 0.56, group: "urn:tag:specialty_dish:place" }, { tagId: "urn:tag:specialty_dish:place:other", affinity: 0.2, group: "urn:tag:specialty_dish:place" }];

function memWith(lift: number): { mem: ToolMemory; special: Candidate } {
  const mem = new ToolMemory();
  mem.profile = { storeId: "s", tags: [{ tagId: TAG, name: "Cardamom Pastry", kind: "cuisine", affinity: 0.9, lift: 0.34 }], evidenceIds: [], computedAt: "2026-10-28T02:00:00.000Z" };
  const ev = makeEvidence({ source: "tokenfactory", endpoint: "/v1/embeddings", params: { tagId: TAG }, summary: "Bun matches cardamom.", metrics: { lift, relevance: 0.8 }, entityIds: [TAG], mode: "fixture", fetchedAt: "2026-10-28T02:00:00.000Z" });
  mem.addEvidence([ev]);
  const special: Candidate = { kind: "special", menuItem: { id: "m1", name: "Cardamom Bun", category: "bakery", price: 4, currency: "USD", description: null, source: "manual" }, tagNames: ["Cardamom Pastry"], lift, evidenceIds: [ev.id] };
  return { mem, special };
}

describe("evidence verifier", () => {
  it("recomputes lift as store affinity minus the baseline, using the list's floor for a tag the baseline lacks", () => {
    const { mem } = memWith(0.34);
    const p = payloadFrom(mem, baseline);
    expect(recomputeLift(TAG, p)).toBeCloseTo(0.34, 6);
    mem.profile!.tags.push({ tagId: "urn:tag:specialty_dish:place:new", name: "New", kind: "cuisine", affinity: 0.7, lift: 0.5 });
    // Not in the baseline: it sits at the lowest affinity of its own list (0.2).
    expect(recomputeLift("urn:tag:specialty_dish:place:new", payloadFrom(mem, baseline))).toBeCloseTo(0.5, 6);
    expect(recomputeLift(TAG, payloadFrom(mem, null))).toBeNull();
    expect(recomputeLift("urn:tag:unknown", payloadFrom(mem, baseline))).toBeNull();
  });

  it("passes an item whose lift recomputes and whose ids are all in the payload", () => {
    const { mem, special } = memWith(0.34);
    expect(verifyCandidate(special, mem, payloadFrom(mem, baseline))).toMatchObject({ ok: true, verification: { lift: "recomputed", entities: "found" } });
    // Rounding to two decimals is tolerated.
    const near = memWith(0.34 + LIFT_TOLERANCE - 0.005);
    expect(verifyCandidate(near.special, near.mem, payloadFrom(near.mem, baseline)).ok).toBe(true);
  });

  it("drops an item whose cited lift does not recompute", () => {
    const { mem, special } = memWith(0.8);
    const out = verifyCandidate(special, mem, payloadFrom(mem, baseline));
    expect(out).toMatchObject({ ok: false, reason: "lift_mismatch", verification: { lift: "mismatch", entities: "found" } });
    expect(out.detail).toContain("cited 0.80, recomputed 0.34");
  });

  it("drops an item that cites an entity the Qloo payload never returned", () => {
    const { mem, special } = memWith(0.34);
    const stray = makeEvidence({ source: "tokenfactory", endpoint: "/v1/rerank", params: {}, summary: "Made up.", entityIds: ["place-that-does-not-exist"], mode: "fixture", fetchedAt: "2026-10-28T02:00:00.000Z" });
    mem.addEvidence([stray]);
    const out = verifyCandidate({ ...special, evidenceIds: [...special.evidenceIds, stray.id] }, mem, payloadFrom(mem, baseline));
    expect(out).toMatchObject({ ok: false, reason: "entity_missing", verification: { entities: "missing" } });
  });

  it("drops an event whose tie-in is not a listing Tavily returned", () => {
    const { mem } = memWith(0.34);
    const event: Candidate = { kind: "event", day: "Fri", time: "19:00", tieIn: { title: "Invented Fair", url: "https://example.com/invented", source: "tavily" }, evidenceIds: [mem.allEvidence()[0].id] };
    const out = verifyCandidate(event, mem, payloadFrom(mem, baseline));
    expect(out).toMatchObject({ ok: false, reason: "entity_missing" });
    expect(out.detail).toContain("Tavily");
  });

  it("keeps an item unverified, never failed, when no city baseline is cached", () => {
    const { mem, special } = memWith(0.34);
    expect(verifyCandidate(special, mem, payloadFrom(mem, null))).toMatchObject({ ok: true, unverified: true, verification: null });
  });

  it("the seeded bad item cites a place the payload lacks and is always caught", () => {
    const { mem } = memWith(0.34);
    const seeded = seededBadCandidate(mem)!;
    expect(seeded.kind === "partner" && seeded.place.entity.name).toContain("Seeded Test");
    expect(verifyCandidate(seeded, mem, payloadFrom(mem, baseline))).toMatchObject({ ok: false, reason: "entity_missing" });
    expect(seededBadCandidate(new ToolMemory())).toBeNull();
  });
});

describe("verifier in the build", () => {
  const edition = async (h: Awaited<ReturnType<typeof harness>>) => {
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const ids = (events.at(-1) as { editionIds: string[] }).editionIds;
    return { events, editions: await Promise.all(ids.map((id) => h.repo.getEdition(id))) };
  };

  it("stamps each kept item with its verification and persists it", async () => {
    const h = await harness({ storeCount: 1 });
    const { editions } = await edition(h);
    for (const item of editions[0]!.items) {
      expect(EditionItem.safeParse(item).success).toBe(true);
      expect(item.verification).toEqual({ lift: "recomputed", entities: "found" });
    }
    const counts = await readVerifierCounts(h.repo);
    expect(counts).toMatchObject({ checked: 4, liftMismatch: 0, entityMissing: 0, seededCaught: 0 });
  });

  it("drops the special when the cached baseline contradicts its lift, says so, and counts it for /limits", async () => {
    const h = await harness({ storeCount: 2, qloo: { baseline: "skewed" } });
    const { events, editions } = await edition(h);
    const dropped = events.filter((e) => e.type === "error" && e.code === "item_dropped");
    expect(dropped).toHaveLength(2);
    expect(dropped[0]).toMatchObject({ message: expect.stringContaining("did not recompute") });
    for (const ed of editions) expect(ed!.items.map((i) => i.kind)).toEqual(["sound", "partner", "event"]);
    const counts = await readVerifierCounts(h.repo);
    expect(counts.liftMismatch).toBe(2);
    expect(droppedForEvidence(counts)).toBe(2);
  });

  it("keeps items, unverified, when there is no baseline", async () => {
    const h = await harness({ storeCount: 1, qloo: { baseline: "none" } });
    const { editions } = await edition(h);
    const special = editions[0]!.items.find((i) => i.kind === "special")!;
    expect(special.verification).toBeNull();
    expect((await readVerifierCounts(h.repo)).unverified).toBe(1);
  });

  it("counts evidence-less drops too", async () => {
    const h = await harness({ storeCount: 1, qloo: { placesWithoutEvidence: true }, tf: { rerankFails: true } });
    await edition(h);
    expect(droppedForEvidence(await readVerifierCounts(h.repo))).toBe(1);
  });

  it("seeds one labelled bad item on the first store of a run in fixture mode, caught and counted apart", async () => {
    const h = await harness({ storeCount: 2, seedBadItem: true });
    const { events, editions } = await edition(h);
    const seeded = events.filter((e) => e.type === "error" && e.code === "seeded_test_dropped");
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ storeId: h.storeIds[0], message: expect.stringContaining("Seeded test item (fixture mode only)") });
    // It never becomes an item, and it is not counted as a real drop.
    for (const ed of editions) expect(ed!.items).toHaveLength(4);
    const counts = await readVerifierCounts(h.repo);
    expect(counts.seededCaught).toBe(1);
    expect(droppedForEvidence(counts)).toBe(0);
  });

  it("never seeds unless asked", async () => {
    const h = await harness({ storeCount: 1 });
    const { events } = await edition(h);
    expect(events.some((e) => e.type === "error" && String(e.code).startsWith("seeded"))).toBe(false);
  });
});
