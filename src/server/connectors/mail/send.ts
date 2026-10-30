import type { MailConnRow } from "../comms/store";
import type { CommsDeps } from "../comms/deps";
import { ComposioClient, COMPOSIO_TOOLS, type ExecuteResult } from "./composio";
import { buildMime, mailbox, toRaw } from "./mime";

export interface OutboundMail {
  to: string;
  toName: string | null;
  subject: string;
  html: string;
  text: string;
}

export interface SentMail {
  messageId: string | null;
  /** Gmail thread id; null for Outlook (replies are matched on subject and sender instead). */
  threadId: string | null;
  /** True when the plain-text alternative went out with the HTML (Gmail MIME path). */
  hasTextPart: boolean;
}

export class MailSendError extends Error {
  constructor(readonly reason: "expired" | "refused" | "unreachable", message: string) {
    super(message);
    this.name = "MailSendError";
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Looks for `threadId` / `id` anywhere in a provider answer (Composio nests it differently across tool versions). */
function findIds(value: unknown, depth = 0): { id: string | null; threadId: string | null } {
  if (!value || typeof value !== "object" || depth > 4) return { id: null, threadId: null };
  const o = value as Record<string, unknown>;
  const direct = { id: str(o.id) ?? str(o.messageId), threadId: str(o.threadId) ?? str(o.thread_id) };
  if (direct.threadId) return direct;
  for (const key of ["response_data", "data", "message"]) {
    const nested = findIds(o[key], depth + 1);
    if (nested.threadId || nested.id) return nested;
  }
  return direct;
}

function classify(e: unknown, message: string): MailSendError {
  const text = `${e instanceof Error ? e.message : ""} ${message}`.toLowerCase();
  if (/expired|revoked|invalid_grant|unauthor|reconnect|not.*active|no.*connected/.test(text)) return new MailSendError("expired", "The mailbox connection expired. Reconnect it from the connections page.");
  if (e instanceof Error && /network|timeout|unavailable/.test(e.message.toLowerCase())) return new MailSendError("unreachable", "The email service could not be reached. It will be tried again on the next approval.");
  return new MailSendError("refused", "The mail provider refused the message.");
}

/**
 * Sends one email from head office's own mailbox. Gmail: a MIME message with a plain-text part and an HTML part, through Composio's proxy to
 * gmail.googleapis.com users.messages.send; if the proxy is refused, the GMAIL_SEND_EMAIL tool sends HTML only. Outlook: OUTLOOK_OUTLOOK_SEND_EMAIL (HTML).
 */
export async function sendMail(deps: CommsDeps, conn: Pick<MailConnRow, "provider" | "connectedAccountId" | "workspaceId" | "composioUserId">, mail: OutboundMail, client?: ComposioClient): Promise<SentMail> {
  const composio = client ?? new ComposioClient(deps.env.composioApiKey, deps.fetchImpl);
  const base = { userId: conn.composioUserId ?? conn.workspaceId, connectedAccountId: conn.connectedAccountId };
  try {
    if (conn.provider === "outlook") {
      const r = await composio.execute(COMPOSIO_TOOLS.outlookSend, {
        ...base, arguments: { to_email: mail.to, ...(mail.toName ? { to_name: mail.toName } : {}), subject: mail.subject, body: mail.html, is_html: true, save_to_sent_items: true },
      });
      if (!r.successful) throw classify(null, r.error ?? "");
      return { messageId: null, threadId: null, hasTextPart: false };
    }
    try {
      const mime = buildMime({ to: mailbox(mail.toName, mail.to), subject: mail.subject, text: mail.text, html: mail.html });
      const sent = await composio.proxy({ ...base, endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", method: "POST", body: { raw: toRaw(mime) } });
      // Accepted: never fall back to the tool now, or the manager would get the card twice.
      const ids = findIds(sent);
      return { messageId: ids.id, threadId: ids.threadId, hasTextPart: true };
    } catch {
      // The proxy refused or was unreachable before sending: the tool is the safe fallback.
    }
    const r: ExecuteResult = await composio.execute(COMPOSIO_TOOLS.gmailSend, { ...base, arguments: { recipient_email: mail.to, subject: mail.subject, body: mail.html, is_html: true } });
    if (!r.successful) throw classify(null, r.error ?? "");
    const ids = findIds(r.data);
    return { messageId: ids.id, threadId: ids.threadId, hasTextPart: false };
  } catch (e) {
    if (e instanceof MailSendError) throw e;
    throw classify(e, "");
  }
}
