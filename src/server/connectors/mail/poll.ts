import { z } from "zod";
import { createLogger } from "../../log";
import type { CommsDeps } from "../comms/deps";
import type { ThreadRow } from "../comms/store";
import { ComposioClient, COMPOSIO_TOOLS } from "./composio";
import { resolveMailConn } from "./dispatch";
import { processInboundMail, type InboundMail } from "./inbound";
import { parseSender } from "./quote";

const log = createLogger("mail:poll");

const POLL_WINDOW_DAYS = 14;
const MIN_GAP_SECONDS = 20;

const GmailThread = z.object({
  data: z.object({
    messages: z.array(z.object({
      messageId: z.string().nullish(), threadId: z.string().nullish(), sender: z.string().nullish(), subject: z.string().nullish(), messageText: z.string().nullish(),
    }).loose()).default([]),
  }).loose(),
}).loose();

const OutlookList = z.object({
  response_data: z.object({
    value: z.array(z.object({
      id: z.string(), subject: z.string().nullish(), conversationId: z.string().nullish(), bodyPreview: z.string().nullish(),
      from: z.object({ emailAddress: z.object({ address: z.string().nullish(), name: z.string().nullish() }).loose().nullish() }).loose().nullish(),
    }).loose()).default([]),
  }).loose(),
}).loose();

/**
 * The on-demand path for reading replies: for each card email sent in the last two weeks, ask the mailbox for new messages from that manager.
 * It needs no webhook secret, so it works on any Composio project, and the connections page and the edition page call it ("Check replies").
 * Throttled to one run per 20 seconds per workspace; message-id claims make it safe next to the webhook.
 */
export async function pollReplies(deps: CommsDeps, workspaceId: string, client?: ComposioClient): Promise<{ checked: number; newReplies: number }> {
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!chain) return { checked: 0, newReplies: 0 };
  const conn = await resolveMailConn(deps, workspaceId, chain.isSample);
  if (!conn) return { checked: 0, newReplies: 0 };
  const bucket = Math.floor(deps.now().getTime() / (MIN_GAP_SECONDS * 1000));
  if (!(await deps.store.claim(`mail-poll:${workspaceId}:${bucket}`, deps.now().getTime()))) return { checked: 0, newReplies: 0 };

  const composio = client ?? new ComposioClient(deps.env.composioApiKey, deps.fetchImpl);
  const cutoff = deps.now().getTime() - POLL_WINDOW_DAYS * 86_400_000;
  const threads = (await deps.store.listThreads(workspaceId)).filter((t) => t.provider === conn.provider && Date.parse(t.sentAt) >= cutoff && (conn.provider === "outlook" || !t.threadId.startsWith("subj:")));
  const base = { userId: conn.composioUserId ?? workspaceId, connectedAccountId: conn.connectedAccountId };
  let checked = 0;
  let newReplies = 0;

  for (const thread of threads) {
    checked++;
    try {
      const mails = conn.provider === "gmail" ? await gmailMessages(composio, base, thread) : await outlookMessages(composio, base, thread);
      for (const mail of mails) if ((await processInboundMail(deps, mail)) === "noted") newReplies++;
    } catch (e) {
      log.warn("thread poll failed", { provider: conn.provider, err: e });
    }
  }
  return { checked, newReplies };
}

async function gmailMessages(composio: ComposioClient, base: { userId: string; connectedAccountId: string }, thread: ThreadRow): Promise<InboundMail[]> {
  const r = await composio.execute(COMPOSIO_TOOLS.gmailThread, { ...base, arguments: { thread_id: thread.threadId } });
  const parsed = GmailThread.safeParse({ data: r.data });
  if (!r.successful || !parsed.success) return [];
  return parsed.data.data.messages.flatMap((m) =>
    m.messageId && m.sender && parseSender(m.sender).email === thread.toEmail.toLowerCase() && !thread.seen.includes(m.messageId)
      ? [{ provider: "gmail" as const, messageId: m.messageId, threadId: m.threadId ?? thread.threadId, from: m.sender, subject: m.subject ?? thread.subject, text: m.messageText ?? "" }]
      : []);
}

async function outlookMessages(composio: ComposioClient, base: { userId: string; connectedAccountId: string }, thread: ThreadRow): Promise<InboundMail[]> {
  const r = await composio.execute(COMPOSIO_TOOLS.outlookList, {
    ...base, arguments: { folder: "Inbox", from_address: thread.toEmail, received_date_time_gt: thread.sentAt, top: 10, orderby: ["receivedDateTime desc"] },
  });
  const parsed = OutlookList.safeParse({ response_data: (r.data as { response_data?: unknown } | null)?.response_data });
  if (!r.successful || !parsed.success) return [];
  return parsed.data.response_data.value.flatMap((m) => {
    const address = m.from?.emailAddress?.address;
    return address && !thread.seen.includes(m.id)
      ? [{ provider: "outlook" as const, messageId: m.id, threadId: m.conversationId ?? null, from: m.from?.emailAddress?.name ? `${m.from.emailAddress.name} <${address}>` : address, subject: m.subject ?? "", text: m.bodyPreview ?? "" }]
      : [];
  });
}
