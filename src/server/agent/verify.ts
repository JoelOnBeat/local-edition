import type { AgentEvent, Chain, EditionItemKind, ItemVerification } from "@/contract";
import { createLogger } from "../log";
import type { ToolMemory } from "./memory";
import type { Candidate } from "./plan";
import type { AgentDeps, BaselineTag } from "./ports";
import { recordVerifierCounts, type VerifierDelta } from "./stats";

const log = createLogger("agent:verify");

/**
 * The evidence verifier (pure TypeScript, no model). For each candidate item it re-derives what the item claims
 * from the Qloo data the run fetched, so a model that invents or garbles a citation cannot reach head office:
 *  - every entity id the item cites (its own entity, plus the entity ids on its evidence rows) must be in the
 *    run's Qloo payload, and an event tie-in must be a listing Tavily returned;
 *  - every evidence row that claims a lift for a block tag is recomputed as store affinity minus the city
 *    baseline, the same formula `qloo/block.ts` uses, from the cached baseline.
 * Failing items are dropped and counted (`stats.ts`), never shown.
 */

export type Dropped = { kind: EditionItemKind; reason: DropReason };
export type DropReason = "no_evidence" | "too_few_artists" | "lift_mismatch" | "entity_missing";

export type Verified = Candidate & { verification: ItemVerification | null };

/** Lifts are stored to two decimals from unrounded inputs, so a recomputation may differ by rounding. */
export const LIFT_TOLERANCE = 0.02;

export interface QlooPayload {
  /** Block profile tag id to affinity, from this run. */
  tagAffinity: Map<string, number>;
  /** The cached city baseline (tag id to affinity), or null when none was cached. */
  baseline: Map<string, number> | null;
  /** Lowest baseline affinity per tag namespace: the stand-in for a tag the baseline list lacks. */
  floors: Map<string, number>;
  /** Every entity id a Qloo tool returned in this run. */
  entityIds: Set<string>;
  /** Event listings Tavily returned in this run. */
  eventUrls: Set<string>;
}

export function payloadFrom(mem: ToolMemory, baseline: BaselineTag[] | null): QlooPayload {
  const entityIds = new Set<string>();
  const add = (id: string | undefined) => { if (id) entityIds.add(id); };
  for (const t of mem.profile?.tags ?? []) add(t.tagId);
  for (const e of mem.allEvidence()) if (e.source === "qloo") e.entityIds.forEach(add);
  for (const p of mem.places.values()) add(p.place.entity.entityId);
  for (const a of mem.artists.values()) add(a.artist.entity.entityId);
  for (const b of mem.brands.values()) add(b.brand.entity.entityId);
  for (const r of mem.rising.values()) add(r.item.entity.entityId);
  return {
    tagAffinity: new Map((mem.profile?.tags ?? []).map((t) => [t.tagId, t.affinity])),
    baseline: baseline?.length ? new Map(baseline.map((t) => [t.tagId, t.affinity])) : null,
    floors: floorsOf(baseline ?? []),
    entityIds,
    eventUrls: new Set([...mem.events.values()].map((e) => e.event.url)),
  };
}

function floorsOf(baseline: BaselineTag[]): Map<string, number> {
  const floors = new Map<string, number>();
  for (const t of baseline) floors.set(t.group, Math.min(floors.get(t.group) ?? Infinity, t.affinity));
  return floors;
}

/** `qloo/block.ts` `computeLifts`: a tag missing from its baseline list sits at that list's lowest affinity. */
export function recomputeLift(tagId: string, p: QlooPayload): number | null {
  const affinity = p.tagAffinity.get(tagId);
  if (affinity === undefined || !p.baseline) return null;
  const group = [...p.floors.keys()].find((g) => tagId.startsWith(`${g}:`));
  const floor = group !== undefined ? p.floors.get(group)! : Math.min(...p.floors.values());
  return affinity - (p.baseline.get(tagId) ?? floor);
}

export interface Outcome {
  ok: boolean;
  /** Null when a claimed lift could not be recomputed (no cached baseline): the item is kept, unverified. */
  verification: ItemVerification | null;
  reason?: "lift_mismatch" | "entity_missing";
  detail: string;
  unverified: boolean;
}

/** The entity ids an item cites directly, beyond its evidence rows. */
function ownEntityIds(c: Candidate): string[] {
  if (c.kind === "partner") return [c.place.entity.entityId];
  if (c.kind === "sound") return c.artists.map((a) => a.entityId);
  return [];
}

export function verifyCandidate(c: Candidate, mem: ToolMemory, payload: QlooPayload): Outcome {
  const rows = mem.evidenceFor(c.evidenceIds);
  const cited = [...new Set([...ownEntityIds(c), ...rows.flatMap((r) => r.entityIds)])];
  const missing = cited.filter((id) => !payload.entityIds.has(id));
  const tieInMissing = c.kind === "event" && c.tieIn !== null && !payload.eventUrls.has(c.tieIn.url);
  const entities: ItemVerification["entities"] = missing.length || tieInMissing ? "missing" : "found";

  let lift: ItemVerification["lift"] = "recomputed";
  let unverified = false;
  const wrong: string[] = [];
  for (const row of rows) {
    const claimed = row.metrics.lift;
    const tagId = row.entityIds.length === 1 ? row.entityIds[0] : undefined;
    if (claimed === undefined || !tagId || !payload.tagAffinity.has(tagId)) continue;
    const recomputed = recomputeLift(tagId, payload);
    if (recomputed === null) { unverified = true; continue; }
    if (Math.abs(recomputed - claimed) > LIFT_TOLERANCE) {
      lift = "mismatch";
      wrong.push(`${tagId}: cited ${claimed.toFixed(2)}, recomputed ${recomputed.toFixed(2)}`);
    }
  }

  if (entities === "missing") {
    const what = missing.length ? `entity ${missing[0]} is not in the Qloo payload` : `the tie-in ${(c as { tieIn: { url: string } }).tieIn.url} is not a listing Tavily returned`;
    return { ok: false, verification: { lift, entities }, reason: "entity_missing", detail: what, unverified };
  }
  if (lift === "mismatch") return { ok: false, verification: { lift, entities }, reason: "lift_mismatch", detail: wrong.join("; "), unverified };
  return { ok: true, verification: unverified ? null : { lift, entities }, detail: "verified", unverified };
}

const SEEDED_PLACE = { entityId: "seeded-test:not-returned-by-qloo", name: "Seeded Test Cafe (fixture mode only, not a real place)", type: "urn:entity:place" };

/** A partner that cites a place Qloo never returned. Built only in fixture mode, to show the verifier working. */
export function seededBadCandidate(mem: ToolMemory): Candidate | null {
  const evidenceId = mem.allEvidence()[0]?.id;
  if (!evidenceId) return null;
  return { kind: "partner", place: { entity: SEEDED_PLACE, address: null, lat: 0, lon: 0, distanceM: 0, tags: [], evidenceIds: [evidenceId] }, evidenceIds: [evidenceId] };
}

const REASON_TEXT: Record<DropReason, string> = {
  no_evidence: "no evidence supports it",
  too_few_artists: "fewer than 8 artists were found",
  lift_mismatch: "its cited lift did not recompute from the Qloo data",
  entity_missing: "it cites something the Qloo data never returned",
};
export const dropMessage = (kind: EditionItemKind, reason: DropReason) => `The ${kind} item was dropped: ${REASON_TEXT[reason]}.`;

const err = (code: string, message: string, storeId: string): AgentEvent => ({ type: "error", code, message, storeId });

/**
 * Verify the candidates that passed the evidence check, emit a notice for each drop, and tally the counts.
 * `seed` adds the labelled bad item (fixture mode, first store of a run only).
 */
export async function* verifyStep(
  deps: AgentDeps,
  chain: Chain,
  storeId: string,
  mem: ToolMemory,
  evidence: { kept: Candidate[]; dropped: Dropped[] },
  opts: { seed?: boolean } = {},
): AsyncGenerator<AgentEvent, { kept: Verified[]; dropped: Dropped[] }> {
  const baseline = await (deps.qloo.baseline?.(chain) ?? Promise.resolve(null)).catch((e: unknown) => {
    log.warn("city baseline unavailable for verification", { err: (e as Error)?.name });
    return null;
  });
  const payload = payloadFrom(mem, baseline);
  const kept: Verified[] = [];
  const dropped: Dropped[] = [...evidence.dropped];
  const delta: VerifierDelta = { checked: evidence.kept.length + evidence.dropped.length };
  for (const d of evidence.dropped) {
    const key = d.reason === "no_evidence" ? "noEvidence" : "tooFewArtists";
    delta[key] = (delta[key] ?? 0) + 1;
  }

  for (const c of evidence.kept) {
    const out = verifyCandidate(c, mem, payload);
    if (out.unverified) delta.unverified = (delta.unverified ?? 0) + 1;
    if (out.ok) { kept.push({ ...c, verification: out.verification }); continue; }
    const reason = out.reason!;
    dropped.push({ kind: c.kind, reason });
    const key = reason === "lift_mismatch" ? "liftMismatch" : "entityMissing";
    delta[key] = (delta[key] ?? 0) + 1;
    yield err("item_dropped", `${dropMessage(c.kind, reason)} (${out.detail})`, storeId);
  }

  if (opts.seed) {
    const seeded = seededBadCandidate(mem);
    const out = seeded && verifyCandidate(seeded, mem, payload);
    if (out && !out.ok) {
      delta.seededCaught = 1;
      yield err("seeded_test_dropped", `Seeded test item (fixture mode only): a partner citing a place Qloo never returned was dropped by the evidence verifier (${out.detail}).`, storeId);
    } else if (out) {
      log.error("the seeded bad item passed the verifier");
      yield err("seeded_test_passed", "Seeded test item (fixture mode only) was NOT caught by the evidence verifier.", storeId);
    }
  }
  await recordVerifierCounts(deps.repo, delta, deps.now());
  return { kept, dropped };
}
