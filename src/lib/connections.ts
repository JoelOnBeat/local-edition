import type { CalendarFeed, Connection, ConnectionsResponse, ConnectorProvider, SyncEvent } from "@/contract";

/** Pure merge of the connector lanes' answers into the one `/api/connections` shape. Used by the server handler and by the mocks. */

const ORDER: ConnectorProvider[] = ["square", "slack", "gmail", "outlook", "calendar", "eventbrite"];
export const MAX_MERGED_EVENTS = 100;

const CALENDAR_CAPS = ["Subscribe once and approved event nights appear in Google Calendar, Apple Calendar or Outlook"];

/** The calendar feed has no account to connect: it counts as connected once approved event nights are in the chain feed. */
export function calendarConnection(feeds: CalendarFeed[]): Connection {
  const chain = feeds.find((f) => f.scope === "chain");
  const count = chain?.eventCount ?? 0;
  return {
    provider: "calendar",
    status: count > 0 ? "connected" : "not_connected",
    mode: count > 0 ? "production" : null,
    accountLabel: count > 0 ? `${count} event ${count === 1 ? "night" : "nights"} in the chain feed` : null,
    connectedAt: null,
    lastSyncAt: null,
    error: null,
    capabilities: CALENDAR_CAPS,
  };
}

export interface ConnectionParts {
  /** Null when Square's status could not be read: the other connections still list. */
  square: Connection | null;
  comms: Connection[];
  feeds: CalendarFeed[];
  /** Each lane's events; duplicates by id collapse. */
  events: SyncEvent[][];
}

export function mergeConnections(parts: ConnectionParts): ConnectionsResponse {
  const connections = [...(parts.square ? [parts.square] : []), ...parts.comms, calendarConnection(parts.feeds)];
  connections.sort((a, b) => ORDER.indexOf(a.provider) - ORDER.indexOf(b.provider));
  const seen = new Map<string, SyncEvent>();
  for (const e of parts.events.flat()) if (!seen.has(e.id)) seen.set(e.id, e);
  const events = [...seen.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_MERGED_EVENTS);
  return { connections, events };
}
