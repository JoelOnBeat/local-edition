import type { Edition, EditionItem, EditionStatus, Evidence, GuardrailResult, ItemStatus, Store } from "@/contract";
import { SAMPLE_MENU, SAMPLE_STORES } from "@/server/sample/chain";
import { editionSpecsA } from "./edition-data-a";
import { editionSpecsB } from "./edition-data-b";
import type { StoreEditionSpec } from "./edition-spec";
import { MOCK_ISSUE_NO, MOCK_NOW, MOCK_WEEK_OF, artists, distanceMeters, evidence, fakeEntityId } from "./helpers";
import { profileEvidence, profileEvidenceId, tagsFor } from "./profiles";

const specs: Record<string, StoreEditionSpec> = { ...editionSpecsA, ...editionSpecsB };
const passed: GuardrailResult = { status: "passed", reasons: [] };

export const MOCK_MODELS = {
  agentModel: "nvidia/Nemotron-3.5-Super-VL",
  copyModel: "nvidia/Nemotron-3_5-Lightning",
};

const slugOf = (store: Store) => store.id.replace(/^store_/, "");
export const mockEditionId = (storeId: string) => `ed_${storeId.replace(/^store_/, "")}_${MOCK_WEEK_OF}`;

function statusOf(items: EditionItem[]): EditionStatus {
  if (items.some((i) => i.status === "flagged")) return "flagged";
  if (items.every((i) => i.status === "approved" || i.status === "edited")) return "approved";
  return "draft";
}

export function buildMockEdition(store: Store, runId = "run_sample_0001"): Edition {
  const slug = slugOf(store);
  const spec = specs[slug];
  const topTags = tagsFor(store.id);
  const point = `POINT(${store.lon} ${store.lat})`;
  const ev = (suffix: string, e: Omit<Evidence, "id" | "fetchedAt" | "mode">): Evidence =>
    evidence({ id: `ev_${slug}_${suffix}`, ...e });

  const sampleNote = "Sample data. ";
  const flavourEv = ev("special", {
    source: "qloo", endpoint: "/v2/insights",
    params: { "filter.type": "urn:tag", "signal.location.query": point, "filter.parents.types": "urn:entity:place" },
    summary: `${sampleNote}Flavours that over-index near ${store.addressLabel}: ${spec.special.flavourTags.join(", ")}.`,
    metrics: { affinity: topTags[0].affinity, lift: topTags[0].lift },
    entityIds: [],
  });
  const copyEv = ev("copy", {
    source: "tokenfactory", endpoint: "/v1/chat/completions",
    params: { model: MOCK_MODELS.copyModel },
    summary: `${sampleNote}Copy drafted in the chain's brand voice by ${MOCK_MODELS.copyModel}.`,
    metrics: {}, entityIds: [],
  });
  const artistRefs = artists(spec.sound.artists);
  const soundEv = ev("sound", {
    source: "qloo", endpoint: "/v2/insights",
    params: { "filter.type": "urn:entity:artist", "signal.location.query": point, "signal.location.radius": "800" },
    summary: `${sampleNote}Artists with the highest affinity in this block, ${artistRefs.slice(0, 3).map((a) => a.name).join(", ")} among them.`,
    metrics: { affinity: 0.88, popularity: 0.71 },
    entityIds: artistRefs.map((a) => a.entityId),
  });
  const pLat = store.lat + spec.partner.dLat;
  const pLon = store.lon + spec.partner.dLon;
  const distanceM = distanceMeters(store.lat, store.lon, pLat, pLon);
  const placeRef = {
    entityId: fakeEntityId(`place:${spec.partner.name}`), name: spec.partner.name, type: "urn:entity:place",
    address: spec.partner.address, lat: pLat, lon: pLon, distanceM,
  };
  const partnerEv = ev("partner", {
    source: "qloo", endpoint: "/v2/insights",
    params: { "filter.type": "urn:entity:place", "signal.location.query": point, "signal.location.radius": "600" },
    summary: `${sampleNote}${spec.partner.name} is ${distanceM} m from the store and shares the block's tastes.`,
    metrics: { affinity: 0.81, distanceM }, entityIds: [placeRef.entityId],
  });
  const eventEv = ev("event", {
    source: "tavily", endpoint: "/search",
    params: { query: `${spec.event.title} ${store.name} New York this week` },
    summary: `${sampleNote}${spec.event.tieIn?.title ?? "No nearby listing found; the event stands on block taste alone."}`,
    metrics: { relevance: 0.74 }, entityIds: [], url: spec.event.tieIn?.url,
  });

  const common = (key: keyof StoreEditionSpec, evidenceIds: string[]) => {
    const s = spec[key];
    const status: ItemStatus = s.status ?? "draft";
    return { id: `item_${slug}_${key}`, status, evidenceIds, guardrail: s.guardrail ?? passed, version: status === "approved" ? 1 : 0 };
  };
  const base = SAMPLE_MENU.find((m) => m.id === `menu_${spec.special.baseMenuSlug}`)!;

  const items: EditionItem[] = [
    {
      ...common("special", [flavourEv.id, copyEv.id]), kind: "special", baseMenuItemId: base.id,
      name: spec.special.name, description: spec.special.description,
      flavourTags: spec.special.flavourTags, staffLine: spec.special.staffLine,
    },
    { ...common("sound", [soundEv.id]), kind: "sound", brief: spec.sound.brief, mood: spec.sound.mood, artists: artistRefs },
    { ...common("partner", [partnerEv.id]), kind: "partner", place: placeRef, reason: spec.partner.reason, offerIdea: spec.partner.offerIdea },
    {
      ...common("event", [eventEv.id, profileEvidenceId(store.id)]), kind: "event",
      title: spec.event.title, day: spec.event.day, time: spec.event.time,
      description: spec.event.description,
      tieIn: spec.event.tieIn ? { ...spec.event.tieIn, source: "tavily" } : null,
    },
  ];

  return {
    id: mockEditionId(store.id), storeId: store.id, weekOf: MOCK_WEEK_OF, issueNo: MOCK_ISSUE_NO,
    items, evidence: [profileEvidence(store.id), flavourEv, copyEv, soundEv, partnerEv, eventEv],
    status: statusOf(items), generatedBy: { ...MOCK_MODELS, runId }, createdAt: MOCK_NOW,
  };
}

export const mockEditions: Edition[] = SAMPLE_STORES.map((s) => buildMockEdition(s));
export const getMockEdition = (id: string) => mockEditions.find((e) => e.id === id);
export { statusOf as editionStatusOf };
