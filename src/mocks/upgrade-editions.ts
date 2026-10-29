import type { EditionReview, GuardrailResult, ItemStatus, ItemVerification, TieInTriage } from "@/contract";
import { MOCK_MODEL_IDS } from "./metrics";

/** Upgrade fields layered onto the mock editions: tie-in triage, Ultra verdicts, verification, certification. */

export const MOCK_CERTIFY_JOB_ID = "nebius-job-7f3a9c21";
export const MOCK_CERTIFIED_AT = "2026-10-26T00:06:48.000Z";

interface TieInExtras {
  venue: string;
  date: string;
  triage: TieInTriage;
}

/** Keyed by store slug. Dates fall in the mock week (Monday 26 Oct 2026). */
export const TIE_IN_EXTRAS: Record<string, TieInExtras> = {
  williamsburg: { venue: "East River State Park", date: "2026-10-31", triage: { kept: true, reason: "A weekend record fair draws the same collectors as Thursday's vinyl night." } },
  "park-slope": { venue: "Grand Army Plaza", date: "2026-10-31", triage: { kept: true, reason: "A Saturday market sends families past the door just before story hour." } },
  astoria: { venue: "Astoria Park", date: "2026-11-01", triage: { kept: false, reason: "A ticketed evening concert; the listing has no daytime set that fits a 16:00 sidewalk session." } },
  harlem: { venue: "Marcus Garvey Park", date: "2026-11-07", triage: { kept: true, reason: "Free outdoor stages two blocks from the store, on the same jazz and soul signal." } },
  "west-village": { venue: "Jefferson Market Library", date: "2026-10-29", triage: { kept: true, reason: "Readings on the same Thursday evening, a four-minute walk away." } },
  "lower-east-side": { venue: "Orchard Street gallery row", date: "2026-10-30", triage: { kept: true, reason: "Gallery weekend opens Friday and the block's print and zine tags rank high." } },
  "upper-east-side": { venue: "Museum Mile", date: "2026-10-30", triage: { kept: true, reason: "Extended gallery hours bring the tea-and-art crowd past at 15:00." } },
  "long-island-city": { venue: "Gantry Plaza State Park", date: "2026-10-31", triage: { kept: true, reason: "The installation sits on the waterfront route the Saturday walk already takes." } },
};

const REVIEWED_AT = "2026-10-26T00:09:12.000Z";
const review = (verdict: EditionReview["verdict"], reason: string, clashWith: string[] = [], hint: string | null = null): EditionReview => ({
  verdict, reason, clashWith, hint, reviewedBy: MOCK_MODEL_IDS.review, at: REVIEWED_AT,
});

/** Ultra's verdict per store. Harlem clashes with Williamsburg: both lead with a record shop and a record night. */
export const MOCK_REVIEWS: Record<string, EditionReview> = {
  williamsburg: review("approve", "The peel cortado, Thursday vinyl night and the Bedford Ave vintage shop all follow the block's thrifting and guitar-music signal. The record-night idea is strongest here, so this store keeps it."),
  "park-slope": review("approve", "Banana loaf, story hour and the bookshop pairing share one reading-and-folk signal, and no other store repeats them."),
  astoria: review("approve", "The sesame latte, Sunday sessions and the pastry counter fit the block's Mediterranean pull. The reworded special line is cleared and nothing overlaps a neighbouring store."),
  harlem: review(
    "needs_change",
    "Harlem's partner is a record shop and its sound brief leans on record picks, which repeats Williamsburg's vinyl night and vintage-shop pairing. Two stores in one chain would read as the same idea.",
    ["store_williamsburg"],
    "Keep the jazz sound brief but swap the partner for a non-record neighbour from the block's food and garden tags, and tie the open mic to the Harlem Week listing instead.",
  ),
  "west-village": review("approve", "Poetry night and the cheese-cellar pairing cite the block's literary tags and stay distinct from every other store."),
  "lower-east-side": review("approve", "The zine swap and its Wednesday slot are specific to this block, and no neighbouring store runs a swap."),
  "upper-east-side": review("approve", "Afternoon tea tasting and the Museum Mile tie-in fit the block. The 15:00 start is early for working visitors, left as is."),
  "long-island-city": review("approve", "The waterfront walk ties to a real park listing. One sound item is still unchecked by guardrails, which is a head-office call rather than the reviewer's."),
};

const verified: ItemVerification = { lift: "recomputed", entities: "found" };
/** Special, sound and partner items re-check their Qloo lift and entity ids; an event rests on a Tavily listing. */
export const verificationFor = (kind: string): ItemVerification | null => (kind === "event" ? null : verified);

/** Approved copy that passed gets the NeMo certification, run on demand from the CLI; everything else stays on the live check. */
export function guardrailWithChecker(g: GuardrailResult, status: ItemStatus): GuardrailResult {
  if (g.status === "passed" && status === "approved") {
    return { ...g, checkedBy: "nemo-guardrails@nebius-job", certifiedAt: MOCK_CERTIFIED_AT, jobId: MOCK_CERTIFY_JOB_ID };
  }
  return { ...g, checkedBy: "live" };
}
