import type { Delivery, SyncEvent } from "@/contract/connectors";
import type { MailProvider, RegenerateSuggestion, StoreCommsTarget, StoreNote } from "@/contract/connectors-comms";
import { StoreCommsTarget as TargetSchema } from "@/contract/connectors-comms";
import { getDocDb, type DocDb } from "./docs";

/** Typed access to the comms documents. Everything is keyed by workspace id; nothing here ever returns a token in clear. */

export interface SlackInstallRow {
  workspaceId: string;
  teamId: string;
  teamName: string | null;
  /** AES-GCM sealed (crypto.ts). Null for the sample chain, whose token is the SLACK_BOT_TOKEN secret. */
  botTokenSealed: string | null;
  headOfficeChannel: string;
  source: "oauth" | "bot_token_secret" | "incoming_webhook";
  /** Sealed incoming-webhook URL (the documented fallback). */
  webhookSealed?: string | null;
  createdAt: string;
  lastSyncAt: string | null;
  error: string | null;
}

export interface MailConnRow {
  workspaceId: string;
  provider: MailProvider;
  connectedAccountId: string;
  /** `pending` from the moment the consent link is made until the callback sees the account ACTIVE. Only active rows send or receive. */
  status: "pending" | "active";
  accountLabel: string | null;
  triggerId: string | null;
  createdAt: string;
  lastSyncAt: string | null;
  error: string | null;
}

/** One outbound card email: replies are matched to the edition by `threadId` (or, for Outlook, the conversation id). */
export interface ThreadRow {
  workspaceId: string;
  editionId: string;
  storeId: string;
  provider: MailProvider;
  threadId: string;
  messageId: string | null;
  toEmail: string;
  subject: string;
  sentAt: string;
  /** Ids of messages already turned into notes, so a replayed webhook or a poll never double-counts. */
  seen: string[];
}

/** What a head-office click did to one store's block of the digest. Rendered from here, never from Slack's copy of the message, so two clicks at once cannot erase each other. */
export type Resolution =
  | { kind: "approved"; userId: string; atUnix: number }
  | { kind: "partial"; userId: string; atUnix: number; approved: number; total: number }
  | { kind: "regenerated"; userId: string; atUnix: number }
  | { kind: "failed"; userId: string; atUnix: number; reason: string }
  /** Approved in the app (or already approved when the button was clicked); Slack only shows that it happened. */
  | { kind: "app"; atUnix: number };

/** One edition's place in a posted digest message. Several editions share one message (`ts`). */
export interface DigestRow {
  workspaceId: string;
  editionId: string;
  /** Slack channel id (C...), or null when posted through an incoming webhook. */
  channelId: string | null;
  /** Message timestamp; null for webhook posts, which can only be updated through the click's response_url. */
  ts: string | null;
  chainName: string;
  weekOf: string;
  part: number;
  parts: number;
  postedAt: string;
  resolution: Resolution | null;
}

const LIST_CAP = 200;

export class CommsStore {
  constructor(readonly db: DocDb) {}

  private async getJson<T>(ws: string, kind: string, key: string): Promise<T | null> {
    const row = await this.db.get(ws, kind, key);
    return row ? (JSON.parse(row.json) as T) : null;
  }
  private async listJson<T>(ws: string, kind: string, limit = LIST_CAP): Promise<T[]> {
    return (await this.db.list(ws, kind, limit)).map((r) => JSON.parse(r.json) as T);
  }
  private putJson(ws: string, kind: string, key: string, value: unknown, at: string, ref: string | null = null): Promise<void> {
    return this.db.put({ workspaceId: ws, kind, key, ref, json: JSON.stringify(value), at });
  }

  // Slack
  getSlackInstall = (ws: string) => this.getJson<SlackInstallRow>(ws, "slack_install", "slack");
  putSlackInstall = (row: SlackInstallRow) => this.putJson(row.workspaceId, "slack_install", "slack", row, row.createdAt, row.teamId);
  deleteSlackInstall = (ws: string) => this.db.delete(ws, "slack_install");

  // Mail connections
  getMailConn = (ws: string, provider: MailProvider) => this.getJson<MailConnRow>(ws, "mail_conn", provider);
  putMailConn = (row: MailConnRow) => this.putJson(row.workspaceId, "mail_conn", row.provider, row, row.createdAt, row.connectedAccountId);
  deleteMailConn = (ws: string, provider: MailProvider) => this.db.delete(ws, "mail_conn", provider);
  async findMailConnByAccount(connectedAccountId: string): Promise<MailConnRow | null> {
    const row = await this.db.findByRef("mail_conn", connectedAccountId);
    return row ? (JSON.parse(row.json) as MailConnRow) : null;
  }

  // Store targets (channel + manager). Missing rows fall back to defaults derived from the store name, see targets.ts.
  async listTargets(ws: string): Promise<StoreCommsTarget[]> {
    return (await this.listJson<unknown>(ws, "target")).flatMap((t) => { const p = TargetSchema.safeParse(t); return p.success ? [p.data] : []; });
  }
  async putTargets(ws: string, targets: StoreCommsTarget[], at: string): Promise<void> {
    for (const t of targets) await this.putJson(ws, "target", t.storeId, t, at);
  }

  // Sync events and deliveries
  addEvent = (ws: string, e: SyncEvent) => this.putJson(ws, "event", e.id, e, e.at);
  listEvents = (ws: string, limit = 30) => this.listJson<SyncEvent>(ws, "event", limit);
  putDelivery = (ws: string, d: Delivery, key: string) => this.putJson(ws, "delivery", key, d, d.at);
  listDeliveries = (ws: string) => this.listJson<Delivery>(ws, "delivery");

  // Mail threads, notes, suggestions
  putThread = (t: ThreadRow) => this.putJson(t.workspaceId, "thread", `${t.provider}:${t.threadId}`, t, t.sentAt, `${t.provider}:${t.threadId}`);
  listThreads = (ws: string) => this.listJson<ThreadRow>(ws, "thread");
  async findThread(provider: MailProvider, threadId: string): Promise<ThreadRow | null> {
    const row = await this.db.findByRef("thread", `${provider}:${threadId}`);
    return row ? (JSON.parse(row.json) as ThreadRow) : null;
  }
  putNote = (ws: string, n: StoreNote) => this.putJson(ws, "note", n.id, n, n.at);
  listNotes = (ws: string) => this.listJson<StoreNote>(ws, "note");
  getNote = (ws: string, id: string) => this.getJson<StoreNote>(ws, "note", id);
  putSuggestion = (ws: string, s: RegenerateSuggestion) => this.putJson(ws, "suggestion", s.id, s, s.createdAt);
  listSuggestions = (ws: string) => this.listJson<RegenerateSuggestion>(ws, "suggestion");
  getSuggestion = (ws: string, id: string) => this.getJson<RegenerateSuggestion>(ws, "suggestion", id);

  // Slack digest messages (so a button click can find and update the message it came from)
  putDigest = (d: DigestRow) => this.putJson(d.workspaceId, "digest", d.editionId, d, d.postedAt);
  getDigest = (ws: string, editionId: string) => this.getJson<DigestRow>(ws, "digest", editionId);

  claim = (key: string, nowMs = Date.now()) => this.db.claim(key, nowMs);
  release = (key: string) => this.db.release(key);
}

let override: CommsStore | undefined;
export function setCommsStore(store: CommsStore | undefined): void { override = store; }
export async function getCommsStore(): Promise<CommsStore> {
  return override ?? new CommsStore(await getDocDb());
}
