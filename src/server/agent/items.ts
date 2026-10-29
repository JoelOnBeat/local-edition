import { EditionItem, type EditionItemKind, type GuardrailResult } from "@/contract";
import { newId } from "@/lib/ids";
import { writeCopy } from "./copy";
import { guardFields } from "./guard";
import type { ToolMemory } from "./memory";
import type { Candidate, CandidateSet } from "./plan";
import type { AgentDeps, StoreContext } from "./ports";
import type { CopyFields } from "./templates";
import type { Dropped } from "./verify";

export const KIND_ORDER: EditionItemKind[] = ["special", "sound", "partner", "event"];

export type { Dropped };

/** Evidence check: an item with no evidence id (or a sound item that cannot reach 8 artists) is dropped, never shown. */
export function evidenceCheck(set: CandidateSet, mem: ToolMemory): { kept: Candidate[]; dropped: Dropped[] } {
  const kept: Candidate[] = [];
  const dropped: Dropped[] = [];
  for (const kind of KIND_ORDER) {
    const c = set[kind];
    if (!c) continue;
    const ids = c.evidenceIds.filter((id) => mem.hasEvidence(id));
    if (!ids.length) dropped.push({ kind, reason: "no_evidence" });
    else if (c.kind === "sound" && c.artists.length < 8) dropped.push({ kind, reason: "too_few_artists" });
    else kept.push({ ...c, evidenceIds: ids });
  }
  return { kept, dropped };
}

export function assembleItem(c: Candidate, f: CopyFields, guardrail: GuardrailResult, id = newId("it"), version = 0): EditionItem | null {
  const common = {
    id,
    version,
    status: guardrail.status === "blocked" ? ("flagged" as const) : ("draft" as const),
    evidenceIds: c.evidenceIds,
    guardrail,
    // Set by the evidence verifier; absent when the candidate never went through it.
    ...("verification" in c ? { verification: c.verification } : {}),
  };
  const raw = (() => {
    switch (c.kind) {
      case "special":
        return { ...common, kind: "special", baseMenuItemId: c.menuItem.id, name: f.name, description: f.description, flavourTags: c.tagNames, staffLine: f.staffLine };
      case "sound":
        return { ...common, kind: "sound", brief: f.brief, mood: f.mood, artists: c.artists.slice(0, 15) };
      case "partner":
        return { ...common, kind: "partner", place: { ...c.place.entity, address: c.place.address, lat: c.place.lat, lon: c.place.lon, distanceM: c.place.distanceM }, reason: f.reason, offerIdea: f.offerIdea };
      case "event":
        return { ...common, kind: "event", title: f.title, day: c.day, time: c.time, description: f.description, tieIn: c.tieIn };
    }
  })();
  const parsed = EditionItem.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface Produced {
  item: EditionItem | null;
  copyModelUsed: boolean;
}

/** Copy (Lightning, or the template) -> guardrails (one rewrite when blocked) -> a contract-valid item. */
export async function produceItem(
  deps: AgentDeps,
  sc: StoreContext,
  mem: ToolMemory,
  c: Candidate,
  opts: { hint?: string; id?: string; version?: number } = {},
): Promise<Produced> {
  const facts = mem.evidenceFor(c.evidenceIds).map((e) => e.summary);
  const copy = await writeCopy(deps, sc, c, facts, opts.hint);
  const guarded = await guardFields(deps, sc, c.kind, copy.fields);
  return { item: assembleItem(c, guarded.fields, guarded.result, opts.id, opts.version), copyModelUsed: !copy.templated };
}
