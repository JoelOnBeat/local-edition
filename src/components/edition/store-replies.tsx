"use client";

import { useState } from "react";
import type { Edition, EditionItem } from "@/contract";
import { Button, Chip } from "../ui";
import { formatDateTime } from "../lib/format";
import { MAIL_POLL_LABEL } from "../lib/use-mail-poll";
import { toShownError } from "../lib/use-async";
import type { StoreReplies as Replies } from "./use-store-replies";
import type { ItemActions } from "./use-item-actions";

const CATEGORY: Record<string, string> = {
  sold_out: "Sold out", sold_well: "Sold well", change_request: "Change request", problem: "Problem", other: "Note",
};

/** What store managers wrote back about this edition, and the changes it suggests. Head office accepts (runs regenerate) or dismisses. */
export function StoreReplies({ edition, replies, actions, readOnly }: { edition: Edition; replies: Replies; actions: ItemActions; readOnly: boolean }) {
  const [working, setWorking] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!replies.notes.length && !replies.suggestions.length && !replies.polling) return null;

  const itemFor = (itemId: string | null): EditionItem | undefined =>
    edition.items.find((i) => (itemId ? i.id === itemId : i.kind === "special"));

  const accept = async (id: string, itemId: string | null, hint: string) => {
    const item = itemFor(itemId);
    if (!item) return;
    setWorking(id);
    setFailed(null);
    try {
      await actions.regenerate(item, hint);
      await replies.settle(id, "applied");
    } catch (e) {
      setFailed(toShownError(e).message);
    } finally {
      setWorking(null);
    }
  };
  const dismiss = async (id: string) => {
    setWorking(id);
    setFailed(null);
    try {
      await replies.settle(id, "dismissed");
    } catch (e) {
      setFailed(toShownError(e).message);
    } finally {
      setWorking(null);
    }
  };

  return (
    <section data-testid="store-replies" className="border-t border-rule pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">From the store</p>
      {replies.notes.length === 0 ? <p className="mt-2 text-[13px] text-muted">No replies from this store yet.</p> : null}
      <ul className="mt-2 grid gap-3">
        {replies.notes.map((n) => (
          <li key={n.id} data-testid="store-note" data-category={n.category} className="grid gap-1 rounded-[var(--radius)] border border-rule p-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <Chip>{CATEGORY[n.category] ?? "Note"}</Chip>
              <span>{n.fromName ?? n.fromEmail}</span>
              <span>{formatDateTime(n.at)}</span>
            </div>
            <p className="text-[14px] font-medium">{n.summary}</p>
            <p className="text-[13px] text-ink-2">{n.excerpt}</p>
          </li>
        ))}
      </ul>
      {replies.suggestions.length ? (
        <ul className="mt-3 grid gap-3" aria-label="Suggested changes">
          {replies.suggestions.map((s) => (
            <li key={s.id} data-testid="suggestion" className="grid gap-2 rounded-[var(--radius)] border border-warn p-3">
              <p className="text-[13px] font-semibold">Suggested change</p>
              <p className="text-[14px]">{s.hint}</p>
              {readOnly ? null : (
                <div className="flex flex-wrap gap-2">
                  <Button data-testid="suggestion-accept" size="sm" variant="primary" loading={working === s.id} disabled={working !== null || actions.busy !== null} onClick={() => accept(s.id, s.itemId, s.hint)}>
                    Accept and regenerate
                  </Button>
                  <Button data-testid="suggestion-dismiss" size="sm" disabled={working !== null} onClick={() => dismiss(s.id)}>Dismiss</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? <p data-testid="suggestion-error" className="mt-2 text-[13px] text-flag">{failed}</p> : null}
      {replies.polling ? <p data-testid="mail-poll-label" className="mt-3 text-[12px] text-muted">{MAIL_POLL_LABEL}</p> : null}
    </section>
  );
}
