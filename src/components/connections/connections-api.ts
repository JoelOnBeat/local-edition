import { z } from "zod";
import {
  CalendarFeedsResponse, SquareConnectResponse, SquareStatus, SquareSyncResponse,
  type CalendarFeed, type Connection, type ConnectorProvider, type SyncEvent,
} from "@/contract";
import { CommsState, DigestResponse, MailConnectResponse } from "@/contract/connectors-comms";
import { ApiClientError } from "@/lib/api-types";
import { clientDataMode } from "@/lib/env";
import { mockCalendarFeeds, mockSquareDisconnected, mockSquareStatus } from "@/mocks/connectors-square";
import { mockCommsState } from "@/mocks/connectors-comms";

/**
 * The connections page's data, read from the connector lanes' routes (B2 Square + calendar, B3 Slack + mail).
 * The shared api-client has no connector methods yet, so this file calls the routes directly and validates every answer with
 * the lanes' zod shapes. NEXT_PUBLIC_DATA_MODE=mock serves the lanes' sample mocks and simulates each action in memory.
 */

export type Settled<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ConnectionsSnapshot {
  square: Settled<SquareStatus>;
  comms: Settled<CommsState>;
  calendar: Settled<CalendarFeed[]>;
}

async function call<T>(url: string, schema: z.ZodType<T>, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiClientError(0, "network", "Could not reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiClientError(res.status, j.code ?? "http_error", j.error ?? `Request failed (${res.status}).`);
  }
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiClientError(502, "invalid_response", "The server answered in an unexpected shape.");
  return parsed.data;
}

const settle = <T,>(p: Promise<T>): Promise<Settled<T>> =>
  p.then((data) => ({ ok: true as const, data }), (e: unknown) => ({ ok: false as const, error: (e as Error)?.message || "Did not load." }));

const Ok = z.object({ ok: z.boolean() });
const PollResponse = z.object({ checked: z.number(), newReplies: z.number() });

// ---- mock state (mock mode only; resets on reload) ----

/** Moves the sample's fixed timestamps so its newest event was two minutes ago, as a live log would read. */
const SHIFT_MS = Math.max(0, Date.now() - 120_000 - Math.max(...[...mockSquareStatus.events, ...mockCommsState.events].map((e) => Date.parse(e.at))));
const move = <T extends string | null>(iso: T): T => (iso ? new Date(Date.parse(iso) + SHIFT_MS).toISOString() : iso) as T;
const fresh = (c: Connection): Connection => ({ ...c, connectedAt: move(c.connectedAt), lastSyncAt: move(c.lastSyncAt) });
const freshEvents = (es: SyncEvent[]) => es.map((e) => ({ ...e, at: move(e.at) }));
const SAMPLE_SQUARE: SquareStatus = {
  ...mockSquareStatus, connection: fresh(mockSquareStatus.connection), events: freshEvents(mockSquareStatus.events),
  lastWebhookAt: move(mockSquareStatus.lastWebhookAt), lastCatalogChangeAt: move(mockSquareStatus.lastCatalogChangeAt),
};
const mock = {
  square: structuredClone(SAMPLE_SQUARE),
  comms: { ...structuredClone(mockCommsState), connections: mockCommsState.connections.map(fresh), events: freshEvents(mockCommsState.events) },
  feeds: structuredClone(mockCalendarFeeds),
};
const wait = (ms = 350) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
let seq = 0;
function mockEvent(provider: ConnectorProvider, direction: "in" | "out", kind: string, summary: string, ok = true): SyncEvent {
  return { id: `sync_local_${++seq}`, provider, at: now(), direction, kind, summary, storeId: null, editionId: null, ok };
}
function setComms(provider: "slack" | "gmail" | "outlook", patch: Partial<Connection>) {
  mock.comms.connections = mock.comms.connections.map((c) => (c.provider === provider ? { ...c, ...patch } : c));
}

const isMock = () => clientDataMode() === "mock";

export async function loadConnections(): Promise<ConnectionsSnapshot> {
  if (isMock()) {
    await wait();
    return { square: { ok: true, data: structuredClone(mock.square) }, comms: { ok: true, data: structuredClone(mock.comms) }, calendar: { ok: true, data: structuredClone(mock.feeds) } };
  }
  const [square, comms, calendar] = await Promise.all([
    settle(call("/api/connectors/square", SquareStatus)),
    settle(call("/api/connectors/comms", CommsState)),
    settle(call("/api/connectors/calendar", CalendarFeedsResponse).then((r) => r.feeds)),
  ]);
  return { square, comms, calendar };
}

/** Starts a connection. Resolves to a URL when the browser must leave for the provider's consent page. */
export async function connect(provider: ConnectorProvider, method: "sandbox" | "oauth" = "sandbox"): Promise<string | null> {
  if (isMock()) {
    await wait(700);
    if (provider === "square") {
      mock.square = { ...structuredClone(SAMPLE_SQUARE), connection: { ...SAMPLE_SQUARE.connection, connectedAt: now(), lastSyncAt: now() }, events: [] };
      mock.square.events = [mockEvent("square", "in", "menu.imported", "Imported 20 menu items and 8 locations from Square."), ...mock.square.events];
    } else if (provider === "slack" || provider === "gmail" || provider === "outlook") {
      const label = provider === "slack" ? "Kettle & Kiln HQ (sample) · #head-office" : `headoffice@kettleandkiln.example (sample)`;
      setComms(provider, { status: "connected", mode: "sandbox", accountLabel: label, connectedAt: now(), lastSyncAt: now(), error: null });
      mock.comms.events = [mockEvent(provider, "in", "connection.created", `Connected ${label}.`), ...mock.comms.events];
    }
    return null;
  }
  if (provider === "square") {
    const r = await call("/api/connectors/square/connect", SquareConnectResponse, { method: "POST", body: { method } });
    return r.kind === "redirect" ? r.authorizeUrl : null;
  }
  if (provider === "slack") return "/api/connectors/slack/install";
  if (provider === "gmail" || provider === "outlook") {
    return (await call("/api/connectors/mail/connect", MailConnectResponse, { method: "POST", body: { provider } })).redirectUrl;
  }
  return null;
}

export async function disconnect(provider: ConnectorProvider): Promise<void> {
  if (isMock()) {
    await wait();
    if (provider === "square") mock.square = structuredClone(mockSquareDisconnected);
    else if (provider === "slack" || provider === "gmail" || provider === "outlook") {
      setComms(provider, { status: "not_connected", mode: null, accountLabel: null, connectedAt: null, lastSyncAt: null, error: null });
    }
    return;
  }
  if (provider === "square") await call("/api/connectors/square", Ok, { method: "DELETE" });
  else await call(`/api/connectors/comms/${provider}`, Ok, { method: "DELETE" });
}

/** The one-click action each connected provider offers. Resolves to a short line for the page to show. */
export async function runAction(provider: ConnectorProvider): Promise<string> {
  if (isMock()) {
    await wait(800);
    if (provider === "square") {
      mock.square.events = [mockEvent("square", "in", "menu.synced", "Checked Square: menu unchanged, 20 items across 8 locations."), ...mock.square.events];
      mock.square.connection = { ...mock.square.connection, lastSyncAt: now() };
      return "Square checked: 20 items, nothing changed.";
    }
    if (provider === "slack") {
      mock.comms.events = [mockEvent("slack", "out", "digest.posted", "Digest for 8 stores posted to #head-office."), ...mock.comms.events];
      return "Digest posted to #head-office for 8 stores.";
    }
    mock.comms.events = [mockEvent(provider, "in", "mail.checked", "Checked the edition threads: no new replies."), ...mock.comms.events];
    return "No new replies since the last check.";
  }
  if (provider === "square") {
    const r = await call("/api/connectors/square/sync", SquareSyncResponse, { method: "POST" });
    const m = r.result.menu;
    return `Square synced: ${m.total} items, ${m.added} added, ${m.changed} changed, ${m.removed} removed.`;
  }
  if (provider === "slack") {
    const r = await call("/api/connectors/slack/digest", DigestResponse, { method: "POST", body: {} });
    return r.posted > 0 ? `Digest posted for ${r.posted} ${r.posted === 1 ? "store" : "stores"}.` : r.note ?? "Nothing to post.";
  }
  const r = await call("/api/connectors/mail/poll", PollResponse, { method: "POST" });
  return r.newReplies > 0 ? `${r.newReplies} new ${r.newReplies === 1 ? "reply" : "replies"} from stores.` : `Checked ${r.checked} threads: no new replies.`;
}
