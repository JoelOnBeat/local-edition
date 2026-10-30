import { z } from "zod";

/**
 * Shared shapes for the chain's connected tools (Square, Slack, Gmail, Outlook, calendar feed). Each connector lane owns its
 * own contract file (connectors-square.ts, connectors-comms.ts) and builds on these; the UI renders every provider from them.
 */

export const ConnectorProvider = z.enum(["square", "slack", "gmail", "outlook", "calendar", "eventbrite"]);
export type ConnectorProvider = z.infer<typeof ConnectorProvider>;

/** `sandbox`: the provider's test environment (the sample chain). `production`: a real account the chain connected. */
export const ConnectorMode = z.enum(["sandbox", "production"]);
export type ConnectorMode = z.infer<typeof ConnectorMode>;

export const Connection = z.object({
  provider: ConnectorProvider,
  status: z.enum(["not_connected", "connecting", "connected", "error"]),
  mode: ConnectorMode.nullable(),
  /** What the chain recognises: "Kettle & Kiln · Square sandbox", "#kk-head-office", "ops@kettleandkiln.com". Never a token. */
  accountLabel: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
  lastSyncAt: z.string().datetime().nullable(),
  /** Plain words for the UI when status is `error`. */
  error: z.string().nullable(),
  /** What this connection does for the chain, one line each ("Reads the menu", "Posts approved specials"). */
  capabilities: z.array(z.string()),
});
export type Connection = z.infer<typeof Connection>;

/** One thing that moved between Local Edition and a connected tool. The connections page shows these newest first. */
export const SyncEvent = z.object({
  id: z.string(),
  provider: ConnectorProvider,
  at: z.string().datetime(),
  direction: z.enum(["in", "out"]),
  /** e.g. `menu.imported`, `menu.changed`, `special.published`, `card.posted`, `approval.clicked`, `mail.sent`, `mail.reply`. */
  kind: z.string(),
  summary: z.string(),
  storeId: z.string().nullable(),
  editionId: z.string().nullable(),
  ok: z.boolean(),
});
export type SyncEvent = z.infer<typeof SyncEvent>;

/** Where an approved edition item went. The edition page shows one chip per delivery, linking out when there is a URL. */
export const Delivery = z.object({
  provider: ConnectorProvider,
  editionId: z.string(),
  itemId: z.string().nullable(),
  status: z.enum(["pending", "sent", "failed", "skipped"]),
  externalId: z.string().nullable(),
  url: z.string().url().nullable(),
  at: z.string().datetime(),
  note: z.string().nullable(),
});
export type Delivery = z.infer<typeof Delivery>;

export const ConnectionsResponse = z.object({
  connections: z.array(Connection),
  events: z.array(SyncEvent),
});
export type ConnectionsResponse = z.infer<typeof ConnectionsResponse>;
