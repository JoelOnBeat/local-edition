import type { CalendarFeed, Edition, EventItem, Store } from "@/contract";
import { HttpError } from "../../http/errors";
import type { Repo } from "../../store";
import { randomToken } from "../crypto";
import type { CalendarTokenRow, ConnectorLedger } from "../types";
import { buildIcs, type IcsEvent } from "./ics";

/** Approved event nights as subscribable calendar feeds: one per store and one for the whole chain, each behind an unguessable token. */

const DURATION_MINUTES = 120;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;

export interface CalendarDeps {
  ledger: ConnectorLedger;
  repo: Repo;
  appUrl: string;
}

const hrefs = (appUrl: string, token: string, label: string): Pick<CalendarFeed, "url" | "webcalUrl" | "googleUrl" | "outlookUrl"> => {
  const url = `${appUrl}/api/calendar/${token}.ics`;
  const webcalUrl = url.replace(/^https?:/, "webcal:");
  return {
    url,
    webcalUrl,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
    outlookUrl: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(label)}`,
  };
};

function eventsOf(editions: Edition[], stores: Map<string, Store>, city: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  for (const edition of editions) {
    const store = stores.get(edition.storeId);
    if (!store || edition.status === "drafting") continue;
    for (const item of edition.items.filter((i): i is EventItem => i.kind === "event" && i.status === "approved")) {
      out.push({
        uid: `${edition.id}-${item.id}`, weekOf: edition.weekOf, day: item.day, time: item.time, durationMinutes: DURATION_MINUTES,
        summary: `${item.title} (${store.name})`,
        description: [item.description, item.tieIn ? `Related: ${item.tieIn.title} ${item.tieIn.url}` : null].filter(Boolean).join("\n"),
        location: `${store.addressLabel}, ${city}`,
        stampedAt: edition.createdAt, sequence: item.version,
        url: item.tieIn?.url.startsWith("https://") ? item.tieIn.url : null,
      });
    }
  }
  return out;
}

/** The ICS text for a token, or 404. Reads the workspace's newest editions at request time, so an approval shows up on the next refresh. */
export async function renderFeed(deps: CalendarDeps, row: CalendarTokenRow): Promise<string> {
  const workspace = await deps.repo.getWorkspace(row.workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!workspace || !chain) throw new HttpError(404, "not_found", "This calendar link is not valid.");
  const all = await deps.repo.listStores(chain.id);
  const stores = row.scope === "store" ? all.filter((s) => s.id === row.storeId) : all;
  if (row.scope === "store" && stores.length === 0) throw new HttpError(404, "not_found", "This calendar link is not valid.");
  const editions = await deps.repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true });
  const name = row.scope === "store" ? `${chain.name} ${stores[0].name}: event nights` : `${chain.name}: event nights`;
  return buildIcs(name, eventsOf(editions, new Map(stores.map((s) => [s.id, s])), chain.city.name));
}

export async function resolveFeed(deps: CalendarDeps, rawToken: string): Promise<CalendarTokenRow> {
  const token = rawToken.replace(/\.ics$/i, "");
  const row = TOKEN_PATTERN.test(token) ? await deps.ledger.resolveCalendarToken(token) : null;
  if (!row) throw new HttpError(404, "not_found", "This calendar link is not valid.");
  return row;
}

/** The feeds the connections page offers: the chain's, then one per store. Tokens are minted on first request and stay stable. */
export async function listFeeds(deps: CalendarDeps, workspaceId: string): Promise<CalendarFeed[]> {
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!chain) throw new HttpError(404, "not_found", "Workspace not found.");
  const stores = await deps.repo.listStores(chain.id);
  const editions = await deps.repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true });
  const byStore = new Map(stores.map((s) => [s.id, s]));
  const count = (storeId: string | null) => eventsOf(editions.filter((e) => storeId === null || e.storeId === storeId), byStore, chain.city.name).length;

  const feeds: CalendarFeed[] = [];
  const chainLabel = `${chain.name}: event nights`;
  const chainToken = await deps.ledger.getOrCreateCalendarToken(workspaceId, "chain", null, () => randomToken(24));
  feeds.push({ scope: "chain", storeId: null, label: chainLabel, eventCount: count(null), ...hrefs(deps.appUrl, chainToken, chainLabel) });
  for (const store of stores) {
    const label = `${chain.name} ${store.name}: event nights`;
    const token = await deps.ledger.getOrCreateCalendarToken(workspaceId, "store", store.id, () => randomToken(24));
    feeds.push({ scope: "store", storeId: store.id, label, eventCount: count(store.id), ...hrefs(deps.appUrl, token, label) });
  }
  return feeds;
}
