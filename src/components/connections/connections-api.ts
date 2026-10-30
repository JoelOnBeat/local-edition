import { z } from "zod";
import {
  CalendarFeedsResponse, SquareConnectResponse, SquareStatus, SquareSyncResponse,
  type CalendarFeed, type Connection, type ConnectionsResponse, type ConnectorProvider,
} from "@/contract";
import { CommsState, DigestResponse, MailConnectResponse } from "@/contract/connectors-comms";
import { getApi } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-types";
import { clientDataMode } from "@/lib/env";
import { addMockEvent, mockConnectorState } from "@/lib/mock-connectors";
import { mockSquareDisconnected, mockSquareStatus } from "@/mocks/connectors-square";

/**
 * The connections page's data, read from the connector lanes' routes (B2 Square + calendar, B3 Slack + mail).
 * The merged log and connection list come from the shared api-client (`getConnections`); the per-lane details and the actions call the
 * routes directly and validate every answer with the lanes' zod shapes. NEXT_PUBLIC_DATA_MODE=mock serves the shared mock
 * connector state (src/lib/mock-connectors.ts) and simulates each action in memory.
 */

export type Settled<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ConnectionsSnapshot {
  /** The merged answer of GET /api/connections: every connection plus all sync events newest first. */
  merged: Settled<ConnectionsResponse>;
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

function resetSquare(next: SquareStatus) {
  mockConnectorState().square = next;
}

const Ok = z.object({ ok: z.boolean() });
const PollResponse = z.object({ checked: z.number(), newReplies: z.number() });

// ---- mock mode: the shared connector state (src/lib/mock-connectors.ts), so actions here and approvals elsewhere show up together ----

const wait = (ms = 350) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
function setComms(provider: "slack" | "gmail" | "outlook", patch: Partial<Connection>) {
  const st = mockConnectorState();
  st.comms.connections = st.comms.connections.map((c) => (c.provider === provider ? { ...c, ...patch } : c));
}

const isMock = () => clientDataMode() === "mock";

export async function loadConnections(): Promise<ConnectionsSnapshot> {
  const merged = settle(getApi().getConnections());
  if (isMock()) {
    await wait();
    const st = mockConnectorState();
    return {
      merged: await merged,
      square: { ok: true, data: structuredClone(st.square) },
      comms: { ok: true, data: structuredClone(st.comms) },
      calendar: { ok: true, data: structuredClone(st.feeds) },
    };
  }
  const [all, square, comms, calendar] = await Promise.all([
    merged,
    settle(call("/api/connectors/square", SquareStatus)),
    settle(call("/api/connectors/comms", CommsState)),
    settle(call("/api/connectors/calendar", CalendarFeedsResponse).then((r) => r.feeds)),
  ]);
  return { merged: all, square, comms, calendar };
}

/** Starts a connection. Resolves to a URL when the browser must leave for the provider's consent page. */
export async function connect(provider: ConnectorProvider, method: "sandbox" | "oauth" = "sandbox"): Promise<string | null> {
  if (isMock()) {
    await wait(700);
    const st = mockConnectorState();
    if (provider === "square") {
      const events = st.square.events;
      resetSquare({ ...structuredClone(mockSquareStatus), connection: { ...mockSquareStatus.connection, connectedAt: now(), lastSyncAt: now() }, events });
      addMockEvent("square", "in", "menu.imported", "Imported 20 menu items and 8 locations from Square.");
    } else if (provider === "slack" || provider === "gmail" || provider === "outlook") {
      const label = provider === "slack" ? "Kettle & Kiln HQ (sample) · #head-office" : `headoffice@kettleandkiln.example (sample)`;
      setComms(provider, { status: "connected", mode: "sandbox", accountLabel: label, connectedAt: now(), lastSyncAt: now(), error: null });
      addMockEvent(provider, "in", "connection.created", `Connected ${label}.`);
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
    if (provider === "square") resetSquare({ ...structuredClone(mockSquareDisconnected), events: mockConnectorState().square.events });
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
    const st = mockConnectorState();
    if (provider === "square") {
      addMockEvent("square", "in", "menu.synced", "Checked Square: menu unchanged, 20 items across 8 locations.");
      st.square.connection = { ...st.square.connection, lastSyncAt: now() };
      return "Square checked: 20 items, nothing changed.";
    }
    if (provider === "slack") {
      addMockEvent("slack", "out", "digest.posted", "Digest for 8 stores posted to #head-office.");
      return "Digest posted to #head-office for 8 stores.";
    }
    addMockEvent(provider, "in", "mail.checked", "Checked the edition threads: no new replies.");
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

/** Square's status alone, for the setup page. */
export async function loadSquare(): Promise<SquareStatus> {
  if (isMock()) {
    await wait();
    return structuredClone(mockConnectorState().square);
  }
  return call("/api/connectors/square", SquareStatus);
}
