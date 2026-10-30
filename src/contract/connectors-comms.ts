import { z } from "zod";
import { Connection, Delivery, SyncEvent } from "./connectors";

/**
 * Slack and mail (Gmail, Outlook) connectors: approvals and staff cards reach people where they already work, and replies
 * flow back without anyone copying anything. Builds on the shared Connection / SyncEvent / Delivery shapes (connectors.ts).
 *
 * Providers used by this lane: `slack` (own Slack app, Block Kit buttons), `gmail` and `outlook` (through Composio, user_id = workspace id).
 * SyncEvent.kind values this lane writes: `digest.posted`, `approval.clicked`, `regenerate.clicked`, `card.posted`,
 * `mail.sent`, `mail.reply`, `mail.suggestion`, `connection.error`.
 */

const id = z.string().min(1).max(64);

export const MailProvider = z.enum(["gmail", "outlook"]);
export type MailProvider = z.infer<typeof MailProvider>;

/** Where one store's staff card goes: its Slack channel (name without `#`) and its manager's mailbox. Either may be null. */
export const StoreCommsTarget = z.object({
  storeId: id,
  /** `store-williamsburg`. Lowercase letters, digits, hyphens and underscores, as Slack allows. */
  slackChannel: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/).nullable(),
  managerName: z.string().min(1).max(80).nullable(),
  managerEmail: z.string().email().max(254).nullable(),
});
export type StoreCommsTarget = z.infer<typeof StoreCommsTarget>;

/** What a store manager's reply is about. The classifier (Nemotron Lightning, reasoning off) returns exactly one. */
export const MailCategory = z.enum(["sold_out", "sold_well", "change_request", "problem", "other"]);
export type MailCategory = z.infer<typeof MailCategory>;

export const MailClassification = z.object({
  category: MailCategory,
  /** One line, plain words, no quoting of the sender's signature or disclaimers. */
  summary: z.string().min(1).max(200),
});
export type MailClassification = z.infer<typeof MailClassification>;

/** A reply from a store, attached to that store's edition as "From the store" and fed into next week's build input. */
export const StoreNote = z.object({
  id,
  editionId: id,
  storeId: id,
  at: z.string().datetime(),
  provider: MailProvider,
  fromEmail: z.string().max(254),
  fromName: z.string().max(120).nullable(),
  category: MailCategory,
  summary: z.string().max(200),
  /** First ~400 characters of the reply with quoted history removed. */
  excerpt: z.string().max(500),
  threadId: z.string().max(200),
  messageId: z.string().max(200),
});
export type StoreNote = z.infer<typeof StoreNote>;

/** Proactive, never automatic: head office reviews it and decides. Created from a `change_request` reply. */
export const RegenerateSuggestion = z.object({
  id,
  editionId: id,
  storeId: id,
  /** The item the store is asking to change; null when the reply is about the edition as a whole (the special is the default). */
  itemId: id.nullable(),
  noteId: id,
  /** Passed as the regenerate `hint` if head office accepts. */
  hint: z.string().min(1).max(400),
  status: z.enum(["open", "applied", "dismissed"]),
  createdAt: z.string().datetime(),
});
export type RegenerateSuggestion = z.infer<typeof RegenerateSuggestion>;

/** The Slack app's install state for a workspace. Never carries a token. */
export const SlackInstall = z.object({
  teamId: z.string().max(40),
  teamName: z.string().max(120).nullable(),
  /** `head-office`: the chain's digest channel (name without `#`). */
  headOfficeChannel: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  source: z.enum(["oauth", "bot_token_secret", "incoming_webhook"]),
});
export type SlackInstall = z.infer<typeof SlackInstall>;

/** Everything the connections page and the edition page need from this lane in one read. */
export const CommsState = z.object({
  connections: z.array(Connection),
  events: z.array(SyncEvent),
  targets: z.array(StoreCommsTarget),
  deliveries: z.array(Delivery),
  notes: z.array(StoreNote),
  suggestions: z.array(RegenerateSuggestion),
});
export type CommsState = z.infer<typeof CommsState>;

// --- Routes (the owner merges these rows into docs/CONTRACT.md). `workspace` = the le_ws cookie; `signed` = verified signature, no cookie.

export interface CommsRouteSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: "workspace" | "slack-signed" | "composio-signed" | "oauth-state";
  request: z.ZodObject;
  response: z.ZodType;
}

export const MailConnectBody = z.object({ provider: MailProvider });
export const MailConnectResponse = z.object({
  /** Composio-hosted consent page (Gmail or Outlook). The browser goes there; Composio redirects back to /api/connectors/mail/callback. */
  redirectUrl: z.string().url(),
});

export const DigestBody = z.object({
  /** Post the digest for these editions; omit for every finished edition of the current week. */
  editionIds: z.array(id).max(50).optional(),
});
export const DigestResponse = z.object({
  posted: z.number().int().nonnegative(),
  /** Why nothing was posted when `posted` is 0 ("Slack is not connected", "No finished editions"). */
  note: z.string().nullable(),
  deliveries: z.array(Delivery),
});

export const SuggestionPatch = z.object({ status: z.enum(["applied", "dismissed"]) });

export const commsRoutes = {
  getComms: { method: "GET", path: "/api/connectors/comms", auth: "workspace", request: z.object({}), response: CommsState },
  putTargets: {
    method: "PUT",
    path: "/api/connectors/comms/targets",
    auth: "workspace",
    request: z.object({ body: z.object({ targets: z.array(StoreCommsTarget).max(100) }) }),
    response: z.object({ targets: z.array(StoreCommsTarget) }),
  },
  slackInstall: { method: "GET", path: "/api/connectors/slack/install", auth: "workspace", request: z.object({}), response: z.object({}) /* 302 to Slack */ },
  slackCallback: {
    method: "GET",
    path: "/api/connectors/slack/callback",
    auth: "oauth-state",
    request: z.object({ query: z.object({ code: z.string().optional(), state: z.string(), error: z.string().optional() }) }),
    response: z.object({}) /* 302 to /app/connections?connected=slack */,
  },
  slackInteractions: {
    method: "POST",
    path: "/api/connectors/slack/interactions",
    auth: "slack-signed",
    request: z.object({}) /* application/x-www-form-urlencoded: payload=<json> */,
    response: z.object({}) /* 200 empty within 3 s; the work continues in waitUntil */,
  },
  postDigest: { method: "POST", path: "/api/connectors/slack/digest", auth: "workspace", request: z.object({ body: DigestBody }), response: DigestResponse },
  mailConnect: { method: "POST", path: "/api/connectors/mail/connect", auth: "workspace", request: z.object({ body: MailConnectBody }), response: MailConnectResponse },
  mailCallback: {
    method: "GET",
    path: "/api/connectors/mail/callback",
    auth: "oauth-state",
    request: z.object({ query: z.object({ state: z.string(), provider: MailProvider.optional() }).loose() }),
    response: z.object({}) /* 302 to /app/connections?connected=gmail|outlook */,
  },
  mailWebhook: { method: "POST", path: "/api/connectors/mail/webhook", auth: "composio-signed", request: z.object({}), response: z.object({ ok: z.boolean() }) },
  mailPoll: {
    method: "POST",
    path: "/api/connectors/mail/poll",
    auth: "workspace",
    request: z.object({}),
    response: z.object({ checked: z.number().int().nonnegative(), newReplies: z.number().int().nonnegative() }),
  },
  patchSuggestion: {
    method: "PATCH",
    path: "/api/connectors/comms/suggestions/:id",
    auth: "workspace",
    request: z.object({ params: z.object({ id }), body: SuggestionPatch }),
    response: RegenerateSuggestion,
  },
  disconnect: {
    method: "DELETE",
    path: "/api/connectors/comms/:provider",
    auth: "workspace",
    request: z.object({ params: z.object({ provider: z.enum(["slack", "gmail", "outlook"]) }) }),
    response: z.object({ ok: z.boolean() }),
  },
} as const satisfies Record<string, CommsRouteSpec>;

/** Button ids and the compact value Slack echoes back (`v1|<workspaceId>|<editionId>`). Slack signs the callback; we additionally check the team id. */
export const SLACK_ACTIONS = { approve: "le_approve", regenerate: "le_regenerate", open: "le_open" } as const;
