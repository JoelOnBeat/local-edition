import type { Candidate } from "./plan";
import type { StoreContext } from "./ports";

/** Plain copy used when the copy model is unavailable. Still passes through guardrails. */

export type CopyFields = Record<string, string>;

export function templateCopy(c: Candidate, sc: StoreContext): CopyFields {
  const where = sc.store.name;
  switch (c.kind) {
    case "special": {
      const lean = c.tagNames.slice(0, 2).join(" and ") || "local taste";
      return {
        name: `${c.menuItem.name}, ${where} edition`,
        description: `${c.menuItem.description ?? c.menuItem.name} This week's pick for ${where}, where the block leans ${lean}.`,
        staffLine: `Try the ${c.menuItem.name}. It is our ${where} pick this week.`,
      };
    }
    case "sound": {
      const names = c.artists.slice(0, 3).map((a) => a.name).join(", ");
      return { brief: `Keep the room ${c.mood}. Start with ${names} and play artists in their orbit.`, mood: c.mood };
    }
    case "partner":
      return {
        reason: `${c.place.entity.name} is ${Math.round(c.place.distanceM)} m from the counter and shares the taste of ${sc.chain.anchors.map((a) => a.name).join(", ")}.`,
        offerIdea: `Swap counter cards: a flyer for ${c.place.entity.name} here, one of ours there.`,
      };
    case "event": {
      const tie = c.tieIn ? ` timed to ${c.tieIn.title}` : "";
      return {
        title: c.tieIn ? `Listening night at ${where}` : `Neighbourhood night at ${where}`,
        description: `A quiet evening in the shop${tie}. The week's playlist, no agenda.`,
      };
    }
  }
}
