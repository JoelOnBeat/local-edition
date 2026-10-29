import type { CompareResult, Edition, Evidence, JobRun, ProviderStatus, PublicStaffCard, StaffCard, Store, Workspace } from "@/contract";
import { SAMPLE_CHAIN, SAMPLE_CHAIN_ID, SAMPLE_STORES } from "@/server/sample/chain";
import { mockEditions } from "./editions";
import { MOCK_NOW, MOCK_WORKSPACE_ID, fakeEntityId } from "./helpers";
import { getMockProfile, profileEvidence } from "./profiles";
import { mockJobRuns, mockMenu } from "./upgrade-data";

export const mockWorkspace: Workspace = { id: MOCK_WORKSPACE_ID, chainId: SAMPLE_CHAIN_ID, createdAt: MOCK_NOW };

export function mockCompare(a: string, b: string): { result: CompareResult; evidence: Evidence[] } | null {
  const pa = getMockProfile(a);
  const pb = getMockProfile(b);
  if (!pa || !pb) return null;
  const idsB = new Set(pb.tags.map((t) => t.tagId));
  const idsA = new Set(pa.tags.map((t) => t.tagId));
  return {
    result: {
      a, b,
      shared: pa.tags.filter((t) => idsB.has(t.tagId)),
      onlyA: pa.tags.filter((t) => !idsB.has(t.tagId)),
      onlyB: pb.tags.filter((t) => !idsA.has(t.tagId)),
      evidenceIds: [...pa.evidenceIds, ...pb.evidenceIds],
    },
    evidence: [profileEvidence(a), profileEvidence(b)],
  };
}

export const mockToken = (storeId: string) => fakeEntityId(`card:${storeId}`).slice(0, 24);

export function buildMockCard(edition: Edition): StaffCard {
  const byKind = (k: string) => edition.items.find((i) => i.kind === k)!;
  const special = byKind("special");
  const sound = byKind("sound");
  const partner = byKind("partner");
  const event = byKind("event");
  if (special.kind !== "special" || sound.kind !== "sound" || partner.kind !== "partner" || event.kind !== "event") {
    throw new Error("edition is missing an item kind");
  }
  return {
    editionId: edition.id,
    storeId: edition.storeId,
    token: mockToken(edition.storeId),
    lines: [
      { heading: "This week's special", body: `${special.name}. ${special.staffLine}` },
      { heading: "On the speakers", body: `${sound.mood}. Start with ${sound.artists.slice(0, 3).map((a) => a.name).join(", ")}.` },
      { heading: "Next door", body: `${partner.place.name}, ${partner.place.distanceM} m away. ${partner.offerIdea}` },
      { heading: `${event.day} at ${event.time}`, body: `${event.title}. ${event.description}` },
    ],
    guardrail: { status: "passed", reasons: [] },
  };
}

export const mockCards: StaffCard[] = mockEditions.map(buildMockCard);

export function mockPublicCard(token: string): PublicStaffCard | null {
  const card = mockCards.find((c) => c.token === token);
  const store = card && SAMPLE_STORES.find((s: Store) => s.id === card.storeId);
  return card && store ? { card, store, chainName: SAMPLE_CHAIN.name } : null;
}

/** The latest Monday run: the rebuild, which started the certify job. See `mockJobRuns` for one run per mode. */
export const mockJobRun: JobRun = mockJobRuns[0];

export const mockStatus: ProviderStatus = {
  qloo: "fixture",
  tokenfactory: "fixture",
  tavily: "fixture",
  guardrails: "local",
  spend: { usd: 0.42, capUsd: 5 },
};

export const mockWorkspaceBundle = () => ({
  workspace: mockWorkspace,
  chain: structuredClone(SAMPLE_CHAIN),
  stores: structuredClone(SAMPLE_STORES),
  menu: structuredClone(mockMenu),
  latestEditions: structuredClone(mockEditions),
});
