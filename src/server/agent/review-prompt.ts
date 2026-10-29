import type { Chain, EditionItem } from "@/contract";
import { ReviewVerdict } from "@/contract";
import type { Clash, StoreEdition } from "./clash";
import { clip } from "./util";

/** The portfolio review prompt. Static instructions first, then the week's data last, so the provider's prefix cache can serve the head. */

export const REVIEW_SCHEMA_NAME = "portfolio_review";

/** Strict JSON schema for the reviewer's answer: one review per store. */
export const REVIEW_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          storeId: { type: "string" },
          verdict: { type: "string", enum: ReviewVerdict.options },
          reason: { type: "string" },
          clashWith: { type: "array", items: { type: "string" } },
          hint: { type: ["string", "null"] },
        },
        required: ["storeId", "verdict", "reason", "clashWith", "hint"],
        additionalProperties: false,
      },
    },
  },
  required: ["reviews"],
  additionalProperties: false,
};

export function reviewSystem(chain: Chain): string {
  return [
    `Brand voice: ${chain.brandVoice.join(" ")}`,
    `You are head office's reviewer for ${chain.name}, a ${chain.category} chain with several stores. Every week each store gets an edition: a menu special, a sound brief, a local partner and an event night. You see all of them together, plus clashes that code already found between stores.`,
    `For each store return a verdict.
- approve: the edition fits the brand voice, each item rests on its evidence, and nothing clashes with another store.
- needs_change: something should change before head office approves.
Rules:
- A clash needs a fix at only one of the two stores. Mark the store whose item is the weaker local fit needs_change and let the other approve. Never mark both.
- Taste and place only. Any health, diet, nutrition or allergen claim, any price or discount not in the evidence, and any targeting of a group by age, gender, ethnicity or religion is needs_change.
- reason: one or two plain sentences that name the specific item or clash. No filler, no praise.
- hint: for needs_change, ONE instruction about ONE item that head office can apply, written as "<kind>: <instruction>" where kind is special, sound, partner or event (if two items clash, pick the one to change). For approve, null.
- clashWith: the ids of the stores this verdict clashes with. Empty for approve.
- Use only the store ids you are given. Return exactly one review per store.
Reply with only JSON: {"reviews": [{"storeId", "verdict", "reason", "clashWith", "hint"}]}`,
  ].join("\n\n");
}

function itemLine(item: EditionItem, evidence: Map<string, string>): string {
  const proof = item.evidenceIds.map((id) => evidence.get(id)).find(Boolean);
  const note = proof ? ` [evidence: ${clip(proof, 150)}]` : "";
  switch (item.kind) {
    case "special": return `- special: ${item.name}. ${clip(item.description, 160)}${note}`;
    case "sound": return `- sound: ${clip(item.brief, 180)} Artists: ${item.artists.slice(0, 5).map((a) => a.name).join(", ")}.${note}`;
    case "partner": return `- partner: ${item.place.name}, ${Math.round(item.place.distanceM)} m. ${clip(item.reason, 140)} Offer: ${clip(item.offerIdea, 120)}${note}`;
    case "event": return `- event: ${item.title}, ${item.day} ${item.time}. ${clip(item.description, 140)}${item.tieIn ? ` Tie-in: ${item.tieIn.title}.` : ""}${note}`;
  }
}

export function reviewUser(entries: StoreEdition[], clashes: Clash[], weekOf: string): string {
  const blocks = entries.map(({ storeId, storeName, edition }) => {
    const evidence = new Map(edition.evidence.map((e) => [e.id, e.summary]));
    const items = edition.items.filter((i) => i.status !== "rejected");
    return [`Store ${storeId} (${storeName})`, ...items.map((i) => itemLine(i, evidence))].join("\n");
  });
  const found = clashes.length ? clashes.map((c) => `- ${c.kind} (${c.itemKind}) between ${c.a} and ${c.b}: ${c.detail}`).join("\n") : "- none";
  return [`Week of ${weekOf}.`, "Clashes found by code:", found, "Editions:", ...blocks].join("\n\n");
}
