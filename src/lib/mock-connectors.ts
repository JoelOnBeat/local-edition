import type { CalendarFeed, CommsState, Connection, ConnectionsResponse, ConnectorProvider, Delivery, Edition, EditionItem, RegenerateSuggestion, SquareStatus, SyncEvent } from "@/contract";
import { mockEditions } from "@/mocks/editions";
import { mockCommsState } from "@/mocks/connectors-comms";
import { mockCalendarFeeds, mockSquareStatus } from "@/mocks/connectors-square";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { mergeConnections } from "./connections";

/**
 * The mock backend's connector state (NEXT_PUBLIC_DATA_MODE=mock): one module-level copy shared by the mock ApiClient and the
 * connections page's actions, so an approval in one shows up as a delivery chip and a sync-log line in the other. Resets on reload.
 * Everything here is the labelled sample chain; nothing leaves the browser.
 */

export interface MockConnectorState {
  square: SquareStatus;
  comms: CommsState;
  feeds: CalendarFeed[];
  /** Where approved items went, keyed provider:edition:item so a second approval does not double-post. */
  deliveries: Map<string, Delivery>;
}

const now = () => new Date().toISOString();

function fresh(): MockConnectorState {
  // The sample's fixed timestamps move so its newest event reads as two minutes old, the way a live log would.
  const newest = Math.max(...[...mockSquareStatus.events, ...mockCommsState.events].map((e) => Date.parse(e.at)));
  const shift = Math.max(0, Date.now() - 120_000 - newest);
  const move = <T extends string | null>(iso: T): T => (iso ? new Date(Date.parse(iso) + shift).toISOString() : iso) as T;
  const conn = (c: Connection): Connection => ({ ...c, connectedAt: move(c.connectedAt), lastSyncAt: move(c.lastSyncAt) });
  const events = (es: SyncEvent[]) => es.map((e) => ({ ...e, at: move(e.at) }));
  const state: MockConnectorState = {
    square: {
      ...structuredClone(mockSquareStatus), connection: conn(mockSquareStatus.connection), events: events(mockSquareStatus.events),
      lastWebhookAt: move(mockSquareStatus.lastWebhookAt), lastCatalogChangeAt: move(mockSquareStatus.lastCatalogChangeAt),
    },
    comms: {
      ...structuredClone(mockCommsState),
      connections: mockCommsState.connections.map(conn),
      events: events(mockCommsState.events),
      // Deliveries are derived below from the approved sample editions and from approvals made in this session.
      deliveries: [],
      notes: mockCommsState.notes.map((n) => ({ ...n, at: move(n.at) })),
      suggestions: mockCommsState.suggestions.map((s) => ({ ...s, createdAt: move(s.createdAt) })),
    },
    feeds: structuredClone(mockCalendarFeeds),
    deliveries: new Map(),
  };
  // Editions already approved in the sample have already been delivered.
  for (const e of mockEditions) {
    deliver(state, { ...e, status: "draft", items: e.items.map((i) => ({ ...i, status: "draft" })) }, e, e.storeId);
  }
  return state;
}

let state = fresh();
export const mockConnectorState = (): MockConnectorState => state;
export function resetMockConnectors(): void {
  state = fresh();
}

function connected(s: MockConnectorState, p: ConnectorProvider): boolean {
  return p === "square" ? s.square.connection.status === "connected" : s.comms.connections.some((c) => c.provider === p && c.status === "connected");
}

let seq = 0;
export function addMockEvent(provider: ConnectorProvider, direction: "in" | "out", kind: string, summary: string, ok = true, ref: { storeId?: string; editionId?: string } = {}): SyncEvent {
  const event: SyncEvent = { id: `sync_local_${++seq}`, provider, at: now(), direction, kind, summary, storeId: ref.storeId ?? null, editionId: ref.editionId ?? null, ok };
  if (provider === "square") state.square.events = [event, ...state.square.events];
  else state.comms.events = [event, ...state.comms.events];
  return event;
}

export const mockMergedConnections = (): ConnectionsResponse =>
  mergeConnections({
    square: state.square.connection,
    comms: state.comms.connections,
    feeds: state.feeds,
    events: [state.square.events, state.comms.events],
  });

export const mockDeliveriesFor = (editionId: string): Delivery[] =>
  [...state.deliveries.values()].filter((d) => d.editionId === editionId).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

function put(s: MockConnectorState, d: Delivery): boolean {
  const key = `${d.provider}:${d.editionId}:${d.itemId ?? ""}`;
  if (s.deliveries.has(key)) return false;
  s.deliveries.set(key, d);
  return true;
}

function storeName(id: string): string {
  return SAMPLE_STORES.find((s) => s.id === id)?.name ?? "the store";
}

/** What approving moved: a newly approved special goes to Square; a newly approved edition sends its staff card to Slack and mail. */
function deliver(s: MockConnectorState, before: Edition, after: Edition, storeId: string, log = false): void {
  const was = new Map(before.items.map((i) => [i.id, i.status]));
  const name = storeName(storeId);
  for (const item of after.items.filter((i): i is Extract<EditionItem, { kind: "special" }> => i.kind === "special" && i.status === "approved" && was.get(i.id) !== "approved")) {
    if (!connected(s, "square")) continue;
    const added = put(s, {
      provider: "square", editionId: after.id, itemId: item.id, status: "sent", externalId: `KK${item.id.replace(/[^a-z0-9]/gi, "").slice(0, 10).toUpperCase()}`,
      url: null, at: now(), note: `Limited item at ${name}. Re-approving updates it instead of adding another.`,
    });
    if (added && log) addMockEvent("square", "out", "special.published", `Published "${item.name}" to Square at ${name}.`, true, { storeId, editionId: after.id });
  }
  if (after.status === "approved" && before.status !== "approved") {
    if (connected(s, "slack") && put(s, { provider: "slack", editionId: after.id, itemId: null, status: "sent", externalId: null, url: null, at: now(), note: `#store-${name.toLowerCase().replace(/\s+/g, "-")}` }) && log) {
      addMockEvent("slack", "out", "card.posted", `Staff card posted to the ${name} channel.`, true, { storeId, editionId: after.id });
    }
    for (const p of ["gmail", "outlook"] as const) {
      if (connected(s, p) && put(s, { provider: p, editionId: after.id, itemId: null, status: "sent", externalId: null, url: null, at: now(), note: `to the ${name} manager` }) && log) {
        addMockEvent(p, "out", "mail.sent", `Staff card emailed to the ${name} manager.`, true, { storeId, editionId: after.id });
      }
    }
  }
}

export const mockOnApproval = (before: Edition, after: Edition): void => deliver(state, before, after, after.storeId, true);

/** After a build finishes, Slack gets the head-office digest when it is connected. */
export function mockAfterBuild(storeCount: number): void {
  if (connected(state, "slack") && storeCount > 0) {
    addMockEvent("slack", "out", "digest.posted", `Digest for ${storeCount} store${storeCount === 1 ? "" : "s"} posted to #head-office.`);
  }
}

export const mockComms = (): CommsState => ({ ...structuredClone(state.comms), suggestions: state.comms.suggestions.filter((s) => s.status === "open") });

export function mockPatchSuggestion(id: string, status: "applied" | "dismissed"): RegenerateSuggestion | null {
  const found = state.comms.suggestions.find((s) => s.id === id);
  if (!found) return null;
  const next = { ...found, status };
  state.comms.suggestions = state.comms.suggestions.map((s) => (s.id === id ? next : s));
  return structuredClone(next);
}
