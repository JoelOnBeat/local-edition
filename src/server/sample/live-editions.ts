import type { Edition } from "@/contract";
import { qlooLiveOnly } from "../qloo/mode";

/**
 * Which demo editions a new sample workspace may copy. Production Qloo is live-only (30 Oct): a sample workspace shows an edition only
 * when every Qloo number on it came from a live Qloo call (`live`) or a saved live answer (`cache`). An edition left by a recorded or
 * sample run (`replay`, `fixture`) is never copied, and neither is one that built no items: that store reads "No edition yet".
 */
export function hasSyntheticQloo(edition: Pick<Edition, "evidence">): boolean {
  // Outside production (unit tests, `next dev`) sample evidence is the only kind there is, so it is not a reason to skip an edition.
  return qlooLiveOnly() && edition.evidence.some((ev) => ev.source === "qloo" && ev.mode !== "live" && ev.mode !== "cache");
}

export function seedableEditions(editions: Edition[]): Edition[] {
  return editions.filter((e) => e.status !== "drafting" && e.items.length > 0 && !hasSyntheticQloo(e));
}
