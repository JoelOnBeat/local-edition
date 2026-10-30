import type { MailProvider, RegenerateSuggestion, StoreNote } from "@/contract/connectors-comms";
import { newId } from "@/lib/ids";
import { createLogger } from "../../log";
import type { CommsDeps } from "../comms/deps";
import { recordEvent } from "../comms/events";
import type { ThreadRow } from "../comms/store";
import { eventOf, specialOf } from "../slack/blocks";
import { classifyReply } from "./classify";
import { excerptOf, normalizeSubject, parseSender, stripQuoted } from "./quote";

const log = createLogger("mail:inbound");

/** A new message in the connected mailbox, normalised from a Composio trigger event or a thread poll. */
export interface InboundMail {
  provider: MailProvider;
  messageId: string;
  threadId: string | null;
  from: string;
  subject: string;
  text: string;
}

export type InboundResult = "noted" | "duplicate" | "not_a_reply" | "empty";

export const subjectKey = (subject: string): string => `subj:${normalizeSubject(subject)}`;

/** The card email this message answers: same thread id, else same subject from the same person. */
async function matchThread(deps: CommsDeps, mail: InboundMail): Promise<ThreadRow | null> {
  const sender = parseSender(mail.from).email;
  const candidates = [
    ...(mail.threadId ? [await deps.store.findThread(mail.provider, mail.threadId)] : []),
    await deps.store.findThread(mail.provider, subjectKey(mail.subject)),
  ];
  const thread = candidates.find((t): t is ThreadRow => !!t) ?? null;
  return thread && thread.toEmail.toLowerCase() === sender ? thread : null;
}

/**
 * One reply from a store manager becomes: a "From the store" note on that store's edition (classified by Nemotron Lightning), a
 * SyncEvent, a next-week signal (see `storeSignals`) and, for a change request, a suggested regenerate that head office decides on.
 * Idempotent per message id: a replayed webhook, a poll and a webhook for the same message produce one note.
 */
export async function processInboundMail(deps: CommsDeps, mail: InboundMail): Promise<InboundResult> {
  if (!(await deps.store.claim(`mail-msg:${mail.provider}:${mail.messageId}`, deps.now().getTime()))) return "duplicate";
  const thread = await matchThread(deps, mail);
  if (!thread) return "not_a_reply";
  const reply = stripQuoted(mail.text);
  if (!reply) return "empty";

  const { workspaceId } = thread;
  const edition = await deps.repo.getEdition(thread.editionId);
  const store = edition ? await deps.repo.getStore(edition.storeId) : null;
  if (!edition || !store) return "not_a_reply";

  const verdict = await classifyReply((await deps.agent()).chat, reply, {
    storeName: store.name,
    specialName: specialOf(edition)?.name ?? null,
    eventTitle: eventOf(edition)?.title ?? null,
  });
  const sender = parseSender(mail.from);
  const at = deps.now().toISOString();
  const note: StoreNote = {
    id: newId("note"), editionId: edition.id, storeId: store.id, at, provider: mail.provider, fromEmail: sender.email.slice(0, 254), fromName: sender.name?.slice(0, 120) ?? null,
    category: verdict.category, summary: verdict.summary, excerpt: excerptOf(reply), threadId: thread.threadId.slice(0, 200), messageId: mail.messageId.slice(0, 200),
  };
  await deps.store.putNote(workspaceId, note);
  await deps.store.putThread({ ...thread, seen: [...thread.seen, mail.messageId].slice(-50) });
  await recordEvent(deps.store, workspaceId, {
    provider: mail.provider, direction: "in", kind: "mail.reply", storeId: store.id, editionId: edition.id, ok: true,
    summary: `${sender.name ?? store.name} replied (${verdict.category.replace("_", " ")}): ${verdict.summary}`,
  });

  if (verdict.category === "change_request") {
    // Proactive, never automatic: head office sees a suggested regenerate and decides.
    const special = specialOf(edition);
    const suggestion: RegenerateSuggestion = {
      id: newId("sug"), editionId: edition.id, storeId: store.id, itemId: special?.id ?? null, noteId: note.id,
      hint: `The ${store.name} manager asks: ${verdict.summary}`.slice(0, 400), status: "open", createdAt: at,
    };
    await deps.store.putSuggestion(workspaceId, suggestion);
    await recordEvent(deps.store, workspaceId, {
      provider: mail.provider, direction: "in", kind: "mail.suggestion", storeId: store.id, editionId: edition.id, ok: true,
      summary: `Suggested regenerate for ${store.name}: ${verdict.summary}`,
    });
  }
  log.info("reply noted", { category: verdict.category, by: verdict.by });
  return "noted";
}

/**
 * What stores told head office, for the next build. Short, labelled and untrusted: the build must treat these lines as data to weigh,
 * never as instructions. Newest first, at most `limit` per store, only the last 28 days.
 */
export async function storeSignals(deps: CommsDeps, workspaceId: string, storeId: string, limit = 3): Promise<{ category: string; summary: string; at: string }[]> {
  const cutoff = deps.now().getTime() - 28 * 86_400_000;
  return (await deps.store.listNotes(workspaceId))
    .filter((n) => n.storeId === storeId && Date.parse(n.at) >= cutoff && n.category !== "other")
    .slice(0, limit)
    .map((n) => ({ category: n.category, summary: n.summary, at: n.at }));
}
