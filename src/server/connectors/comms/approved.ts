import type { Chain, Edition, StaffCard, Store } from "@/contract";
import { getOrCreateCard } from "../../agent/card";
import { loadEditionAccess } from "../../agent/workspace";
import { HttpError } from "../../http/errors";
import { sha256Hex } from "./crypto";
import type { CommsDeps } from "./deps";

export interface ApprovedCard {
  edition: Edition;
  store: Store;
  chain: Chain;
  card: StaffCard;
  /** Changes when the card's words change, so a re-approved edition with edited copy goes out again and an unchanged one does not. */
  fingerprint: string;
}

export type ApprovedCardResult = { ok: true; value: ApprovedCard } | { ok: false; reason: string };

/**
 * The staff card of an approved edition, ready to send. Same gate as the public card link: the edition must be approved and the card
 * must have passed guardrails (or been rewritten to pass). Anything else is a reason in words, not a send.
 */
export async function loadApprovedCard(deps: CommsDeps, workspaceId: string, editionId: string): Promise<ApprovedCardResult> {
  let access;
  try {
    access = await loadEditionAccess(deps.repo, workspaceId, editionId);
  } catch {
    return { ok: false, reason: "The edition could not be found." };
  }
  if (access.edition.status !== "approved") return { ok: false, reason: "The edition is not approved." };
  let card: StaffCard;
  try {
    card = await getOrCreateCard(await deps.agent(), workspaceId, editionId);
  } catch (e) {
    return { ok: false, reason: e instanceof HttpError ? e.message : "The staff card could not be written right now." };
  }
  const status = card.guardrail.status;
  if (!card.lines.length || (status !== "passed" && status !== "rewritten")) return { ok: false, reason: "Guardrails have not cleared the staff card, so it was not sent." };
  const fingerprint = (await sha256Hex(JSON.stringify(card.lines))).slice(0, 16);
  return { ok: true, value: { edition: access.edition, store: access.store, chain: access.chain, card, fingerprint } };
}
