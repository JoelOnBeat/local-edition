import { z } from "zod";
import { Weekday, type EditionItemKind, type MenuItem, type QlooEntityRef } from "@/contract";
import type { PlaceCandidate, StoreContext } from "./ports";
import type { ToolMemory } from "./memory";
import { timeOf, weekdayOf, weekWindow } from "./util";

/** What the agent hands to the copywriter: picks among tool results, each with its evidence. */

export interface SpecialCandidate { kind: "special"; menuItem: MenuItem; tagNames: string[]; lift: number; angle?: string; evidenceIds: string[] }
export interface SoundCandidate { kind: "sound"; artists: QlooEntityRef[]; mood: string; blockTags: string[]; evidenceIds: string[] }
export interface PartnerCandidate { kind: "partner"; place: PlaceCandidate; rerankScore?: number; angle?: string; evidenceIds: string[] }
export interface EventPick {
  kind: "event";
  day: z.infer<typeof Weekday>;
  time: string;
  tieIn: { title: string; url: string; source: "tavily" } | null;
  angle?: string;
  evidenceIds: string[];
}
export type Candidate = SpecialCandidate | SoundCandidate | PartnerCandidate | EventPick;

export interface CandidateSet {
  special?: SpecialCandidate;
  sound?: SoundCandidate;
  partner?: PartnerCandidate;
  event?: EventPick;
}

/** Avoid repeating what a regenerated item already says. */
export interface Exclusions {
  menuItemIds?: string[];
  placeIds?: string[];
  eventUrls?: string[];
  artistIds?: string[];
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const angle = z.string().max(240).nullish();

export const SubmitArgs = z.object({
  special: z.object({ pairRef: z.string().min(1), angle }).nullish(),
  sound: z.object({ artistRefs: z.array(z.string().min(1)).max(15).nullish(), mood: z.string().min(2).max(60).nullish() }).nullish(),
  partner: z.object({ placeRef: z.string().min(1), angle }).nullish(),
  event: z.object({ eventRef: z.string().nullish(), day: Weekday.nullish(), time: time.nullish(), angle }).nullish(),
});
export type SubmitArgs = z.infer<typeof SubmitArgs>;

export const SUBMIT_TOOL = {
  name: "submit_candidates",
  description: "Finish. Pick one candidate per item kind using the refs the tools returned (s1 pairs, a1 artists, p1 places, e1 events). Omit a kind you have no candidate for. Never invent refs.",
  parameters: {
    type: "object",
    properties: {
      special: { type: "object", properties: { pairRef: { type: "string" }, angle: { type: "string" } }, required: ["pairRef"] },
      sound: { type: "object", properties: { artistRefs: { type: "array", items: { type: "string" }, maxItems: 15 }, mood: { type: "string" } } },
      partner: { type: "object", properties: { placeRef: { type: "string" }, angle: { type: "string" } }, required: ["placeRef"] },
      event: { type: "object", properties: { eventRef: { type: ["string", "null"] }, day: { type: "string", enum: Weekday.options }, time: { type: "string", description: "HH:MM, 24h" }, angle: { type: "string" } } },
    },
    additionalProperties: false,
  },
} as const;

const dedupe = (ids: string[]) => [...new Set(ids)];
const known = (mem: ToolMemory, ids: (string | undefined)[]) => dedupe(ids.filter((i): i is string => !!i && mem.hasEvidence(i)));

function risingEvidence(mem: ToolMemory, entityId: string): string[] {
  return [...mem.rising.values()].filter((r) => r.item.entity.entityId === entityId).flatMap((r) => r.item.evidenceIds);
}

function specialFrom(mem: ToolMemory, sc: StoreContext, ref: string, note?: string | null): SpecialCandidate | null {
  const pair = mem.pairs.find((p) => p.ref === ref);
  const menuItem = pair && sc.menu.find((m) => m.id === pair.menuItemId);
  if (!pair || !menuItem) return null;
  const tagNames = mem.pairs.filter((p) => p.menuItemId === pair.menuItemId).map((p) => p.tagName);
  return {
    kind: "special", menuItem, tagNames: [...new Set([pair.tagName, ...tagNames])].slice(0, 3), lift: pair.lift, angle: note ?? undefined,
    evidenceIds: known(mem, [pair.evidenceId, ...(mem.profile?.evidenceIds ?? []).slice(0, 2)]),
  };
}

function soundFrom(mem: ToolMemory, refs: string[], mood?: string | null): SoundCandidate | null {
  const picked = refs.flatMap((r) => (mem.artists.has(r) ? [mem.artists.get(r)!] : []));
  if (!picked.length) return null;
  const tags = (mem.profile?.tags ?? []).filter((t) => t.kind === "music" || t.kind === "ambience").slice(0, 3).map((t) => t.name);
  return {
    kind: "sound", artists: picked.map((p) => p.artist.entity), mood: mood ?? (tags[0] ?? "easy and unhurried"), blockTags: tags,
    evidenceIds: known(mem, picked.flatMap((p) => [...p.artist.evidenceIds, ...risingEvidence(mem, p.artist.entity.entityId)])),
  };
}

function partnerFrom(mem: ToolMemory, ref: string, note?: string | null): PartnerCandidate | null {
  const entry = mem.places.get(ref);
  if (!entry) return null;
  return {
    kind: "partner", place: entry.place, rerankScore: entry.rerankScore, angle: note ?? undefined,
    evidenceIds: known(mem, [...entry.place.evidenceIds, entry.rerankEvidenceId, ...risingEvidence(mem, entry.place.entity.entityId)]),
  };
}

function eventFrom(mem: ToolMemory, a: { eventRef?: string | null; day?: z.infer<typeof Weekday> | null; time?: string | null; angle?: string | null }): EventPick | null {
  const entry = a.eventRef ? mem.events.get(a.eventRef) : undefined;
  if (a.eventRef && !entry) return null;
  const when = entry?.event.startsAt ?? null;
  const day = a.day ?? (when && weekdayOf(when)) ?? "Thu";
  return {
    kind: "event", day: day as EventPick["day"], time: a.time ?? (when && timeOf(when)) ?? "19:00",
    tieIn: entry ? { title: entry.event.title, url: entry.event.url, source: "tavily" } : null, angle: a.angle ?? undefined,
    evidenceIds: known(mem, entry ? entry.event.evidenceIds : (mem.profile?.evidenceIds ?? []).slice(0, 2)),
  };
}

/** Resolve the model's refs into candidates. `problems` lists refs that do not exist, for the model to fix. */
export function resolveSubmit(args: SubmitArgs, mem: ToolMemory, sc: StoreContext): { set: CandidateSet; problems: string[] } {
  const set: CandidateSet = {};
  const problems: string[] = [];
  if (args.special) {
    const c = specialFrom(mem, sc, args.special.pairRef, args.special.angle);
    if (c) set.special = c; else problems.push(`special.pairRef "${args.special.pairRef}" is not a pair from menu_match (valid: ${mem.pairs.map((p) => p.ref).join(", ") || "none, call menu_match"})`);
  }
  if (args.sound) {
    const refs = args.sound.artistRefs?.length ? args.sound.artistRefs : [...mem.artists.keys()].slice(0, 15);
    const bad = refs.filter((r) => !mem.artists.has(r));
    if (bad.length) problems.push(`sound.artistRefs contains unknown refs: ${bad.join(", ")}`);
    else {
      const c = soundFrom(mem, refs, args.sound.mood);
      if (c) set.sound = c; else problems.push("sound needs artists: call artists_local first");
    }
  }
  if (args.partner) {
    const c = partnerFrom(mem, args.partner.placeRef, args.partner.angle);
    if (c) set.partner = c; else problems.push(`partner.placeRef "${args.partner.placeRef}" is not a place from places_near (valid: ${[...mem.places.keys()].join(", ") || "none, call places_near"})`);
  }
  if (args.event) {
    const c = eventFrom(mem, args.event);
    if (c) set.event = c; else problems.push(`event.eventRef "${args.event.eventRef}" is not an event from events_this_week (valid: ${[...mem.events.keys()].join(", ") || "none"})`);
  }
  return { set, problems };
}

/** The deterministic choice used when the model cannot (or will not) finish: top-ranked of what the tools returned. */
export function chooseDeterministic(mem: ToolMemory, sc: StoreContext, focus?: EditionItemKind, ex: Exclusions = {}): CandidateSet {
  const want = (k: EditionItemKind) => !focus || focus === k;
  const set: CandidateSet = {};

  if (want("special")) {
    const pair = mem.pairs.find((p) => !ex.menuItemIds?.includes(p.menuItemId));
    const c = pair && specialFrom(mem, sc, pair.ref);
    if (c) set.special = c;
  }
  if (want("sound")) {
    const refs = [...mem.artists.values()].filter((a) => !ex.artistIds?.includes(a.artist.entity.entityId)).slice(0, 15).map((a) => a.ref);
    const c = refs.length ? soundFrom(mem, refs) : null;
    if (c) set.sound = c;
  }
  if (want("partner")) {
    const best = [...mem.places.values()]
      .filter((p) => !ex.placeIds?.includes(p.place.entity.entityId))
      .sort((a, b) => (b.rerankScore ?? -1) - (a.rerankScore ?? -1) || (b.place.affinity ?? 0) - (a.place.affinity ?? 0) || a.place.distanceM - b.place.distanceM)[0];
    const c = best && partnerFrom(mem, best.ref);
    if (c) set.partner = c;
  }
  if (want("event")) {
    const { start, end } = weekWindow(sc.weekOf);
    const entry = [...mem.events.values()].find((e) => {
      const d = e.event.startsAt?.slice(0, 10);
      return (!d || (d >= start && d <= end)) && !ex.eventUrls?.includes(e.event.url);
    });
    const c = eventFrom(mem, { eventRef: entry?.ref });
    if (c) set.event = c;
  }
  return set;
}
