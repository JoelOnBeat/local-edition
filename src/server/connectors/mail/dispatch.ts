import type { MailProvider } from "@/contract/connectors-comms";
import { createLogger } from "../../log";
import { loadApprovedCard } from "../comms/approved";
import { liveCommsDeps, takeSampleQuota, type CommsDeps } from "../comms/deps";
import { CARD_ITEM, recordDelivery, recordEvent, resolveTarget } from "../comms/events";
import type { MailConnRow } from "../comms/store";
import type { ApprovedEdition } from "../dispatch";
import { renderCardEmail } from "./html";
import { subjectKey } from "./inbound";
import { MailSendError, sendMail } from "./send";

const log = createLogger("mail:dispatch");

/** The mailbox a workspace sends from: its own active connection (Gmail first), or, for the sample chain, the server's shared sandbox mailbox. */
export async function resolveMailConn(deps: CommsDeps, workspaceId: string, isSample: boolean): Promise<MailConnRow | null> {
  for (const provider of ["gmail", "outlook"] as MailProvider[]) {
    const row = await deps.store.getMailConn(workspaceId, provider);
    if (row?.status === "active") return row;
  }
  if (isSample && deps.env.sampleGmailAccount) {
    return { workspaceId, provider: "gmail", connectedAccountId: deps.env.sampleGmailAccount, composioUserId: deps.env.sampleComposioUser, status: "active", accountLabel: null, triggerId: null, createdAt: deps.now().toISOString(), lastSyncAt: null, error: null };
  }
  return null;
}

/**
 * Post-approval, mail side: the store manager gets the staff card from head office's own mailbox. One email per (edition, card wording): re-approving an
 * unchanged edition sends nothing, re-approving after an edit sends the new card. Records the thread so the manager's reply finds its way back.
 */
export async function dispatchMailWith(deps: CommsDeps, { workspaceId, editionId }: ApprovedEdition): Promise<void> {
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!chain) return;
  const conn = await resolveMailConn(deps, workspaceId, chain.isSample);
  if (!conn) return;

  const approved = await loadApprovedCard(deps, workspaceId, editionId);
  const at = () => deps.now().toISOString();
  const skip = async (note: string): Promise<void> => {
    await recordDelivery(deps.store, workspaceId, { provider: conn.provider, editionId, itemId: CARD_ITEM, status: "skipped", externalId: null, url: null, at: at(), note }, `mail:${editionId}`);
  };
  // The sample chain's shared mailbox has no row of its own; only a stored connection records its sync time or errors.
  const touch = async (patch: Partial<MailConnRow>): Promise<void> => {
    const stored = await deps.store.getMailConn(workspaceId, conn.provider);
    if (stored) await deps.store.putMailConn({ ...stored, ...patch });
  };
  if (!approved.ok) return skip(approved.reason);
  const { edition, store, card, fingerprint } = approved.value;
  const target = resolveTarget(store, chain, await deps.store.listTargets(workspaceId), deps.env);
  if (!target.managerEmail) return skip(`No manager email is set for ${store.name}. Add one on the connections page.`);

  const key = `card-mail:${editionId}:${fingerprint}`;
  if (!(await deps.store.claim(key, deps.now().getTime()))) return;
  if (chain.isSample && !(await takeSampleQuota(deps, "mail"))) {
    await deps.store.release(key);
    return skip("The shared sample mailbox has reached today's sending limit.");
  }

  const mail = renderCardEmail({ chainName: chain.name, store, edition, card, cardUrl: `${deps.env.appUrl}/card/${card.token}`, managerName: target.managerName, isSample: chain.isSample });
  try {
    const sent = await sendMail(deps, conn, { to: target.managerEmail, toName: target.managerName, subject: mail.subject, html: mail.html, text: mail.text });
    const sentAt = at();
    const base = { workspaceId, editionId, storeId: store.id, provider: conn.provider, messageId: sent.messageId, toEmail: target.managerEmail, subject: mail.subject, sentAt, seen: [] as string[] };
    if (sent.threadId) await deps.store.putThread({ ...base, threadId: sent.threadId });
    await deps.store.putThread({ ...base, threadId: subjectKey(mail.subject) }); // fallback key: Outlook, or a Gmail send whose answer carried no thread id
    await recordDelivery(deps.store, workspaceId, { provider: conn.provider, editionId, itemId: CARD_ITEM, status: "sent", externalId: sent.threadId ?? sent.messageId, url: null, at: sentAt, note: `To ${target.managerName ?? target.managerEmail}` }, `mail:${editionId}`);
    await recordEvent(deps.store, workspaceId, { provider: conn.provider, direction: "out", kind: "mail.sent", summary: `Staff card emailed to ${target.managerName ?? target.managerEmail} (${store.name}).`, storeId: store.id, editionId, ok: true });
    await touch({ lastSyncAt: sentAt, error: null });
  } catch (e) {
    await deps.store.release(key);
    const note = e instanceof MailSendError ? e.message : "The email could not be sent.";
    log.warn("card email failed", { err: e });
    if (e instanceof MailSendError && e.reason === "expired") await touch({ error: note });
    await recordDelivery(deps.store, workspaceId, { provider: conn.provider, editionId, itemId: CARD_ITEM, status: "failed", externalId: null, url: null, at: at(), note }, `mail:${editionId}`);
    await recordEvent(deps.store, workspaceId, { provider: conn.provider, direction: "out", kind: "mail.sent", summary: note, storeId: store.id, editionId, ok: false });
  }
}

export async function dispatchMail(approved: ApprovedEdition): Promise<void> {
  await dispatchMailWith(await liveCommsDeps(), approved);
}
