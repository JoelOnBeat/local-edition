import { z } from "zod";
import type { Evidence, Store, TieInTriage } from "@/contract";
import { newId } from "@/lib/ids";
import { tavilyParams, type TavilyRequest } from "./request";

/** One event candidate after triage. Kept ones carry the evidence row that backs the tie-in. */
export interface TriagedEvent {
  title: string;
  url: string;
  venue: string | null;
  /** YYYY-MM-DD when the page gave a real date. */
  date: string | null;
  snippet: string;
  score: number;
  triage: TieInTriage;
  /** Set on kept events: the evidence row an event item cites. */
  evidenceId: string | null;
}

/** What is saved for 7 days: facts only. Evidence rows are rebuilt on read so each edition gets fresh ids. */
export const Snapshot = z.object({
  query: z.string(),
  found: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
  avgScore: z.number().nullable(),
  extractedUrl: z.string().nullable(),
  fetchedAt: z.string(),
  events: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      venue: z.string().nullable(),
      date: z.string().nullable(),
      snippet: z.string(),
      score: z.number(),
      triage: z.object({ kept: z.boolean(), reason: z.string() }),
    }),
  ),
});
export type Snapshot = z.infer<typeof Snapshot>;

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the page";
  }
};

/**
 * Evidence for one store's chain: a summary row carrying the "found N, kept M" counts (in `params` and the
 * summary, because EvidenceMetrics has no counter fields), one row per kept event, and one for the page read.
 */
export function chainEvidence(args: {
  store: Pick<Store, "addressLabel">;
  body: Pick<TavilyRequest, "query" | "topic" | "time_range" | "max_results" | "search_depth">;
  snap: Snapshot;
  mode: Evidence["mode"];
}): { evidence: Evidence[]; events: TriagedEvent[] } {
  const { snap, mode, body } = args;
  const base = { source: "tavily" as const, entityIds: [] as string[], fetchedAt: snap.fetchedAt, mode };
  const keptEvents = snap.events.filter((e) => e.triage.kept);
  const summary: Evidence = {
    ...base,
    id: newId("ev_tv"),
    endpoint: "/search",
    params: { ...tavilyParams(body as TavilyRequest), found: String(snap.found), kept: String(snap.kept) },
    summary: `Tavily found ${snap.found} ${snap.found === 1 ? "listing" : "listings"} near ${args.store.addressLabel}; Nemotron Lightning kept ${snap.kept} and dropped ${snap.found - snap.kept}.`,
    metrics: snap.avgScore === null ? {} : { relevance: snap.avgScore },
    url: keptEvents[0]?.url,
  };
  const rows: Evidence[] = [summary];
  const events: TriagedEvent[] = snap.events.map((e) => {
    if (!e.triage.kept) return { ...e, evidenceId: null };
    const row: Evidence = {
      ...base,
      id: newId("ev_tv"),
      endpoint: "/search",
      params: { query: body.query, listing: e.url },
      summary: `Tie-in: ${e.title}${e.venue ? ` at ${e.venue}` : ""}${e.date ? `, ${e.date}` : ""}. Kept by Lightning triage: ${e.triage.reason}`,
      metrics: { relevance: e.score },
      url: e.url,
    };
    rows.push(row);
    return { ...e, evidenceId: row.id };
  });
  if (snap.extractedUrl) {
    rows.push({
      ...base,
      id: newId("ev_tv"),
      endpoint: "/extract",
      params: { urls: "1", extract_depth: "basic" },
      summary: `Read the page at ${host(snap.extractedUrl)} in full to find each listing's venue and date.`,
      metrics: {},
      url: snap.extractedUrl,
    });
  }
  return { evidence: rows, events };
}
