"use client";

import { useState } from "react";
import type { Edition, EditionItem } from "@/contract";
import { Button, CardBand, Chip } from "../ui";
import { Icon } from "../app-ui/icons";
import { LogoTile } from "../app-ui/tiles";
import { formatDateTime } from "../lib/format";
import { MAIL_POLL_LABEL } from "../lib/use-mail-poll";
import { toShownError } from "../lib/use-async";
import type { StoreReplies as Replies } from "./use-store-replies";
import type { ItemActions } from "./use-item-actions";

const CATEGORY: Record<string, { label: string; tone: "ok" | "warn" | "flag" | "neutral" }> = {
  sold_out: { label: "Sold out", tone: "warn" },
  sold_well: { label: "Sold well", tone: "ok" },
  change_request: { label: "Change request", tone: "warn" },
  problem: { label: "Problem", tone: "flag" },
  other: { label: "Note", tone: "neutral" },
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
    <CardBand
      data-testid="store-replies"
      title="From the store"
      icon={<Icon name="inbox" />}
      actions={replies.notes.length ? <span className="text-[13px] text-muted tnum">{replies.notes.length}</span> : null}
      flush
      footer={replies.polling ? (
        <span data-testid="mail-poll-label" className="flex items-center gap-2 text-[13px] text-muted">
          <span className="le-live-dot size-1.5 rounded-full bg-ok" aria-hidden />
          {MAIL_POLL_LABEL}
        </span>
      ) : undefined}
    >
      {replies.suggestions.length ? (
        <ul className="grid gap-2 p-2" aria-label="Suggested changes">
          {replies.suggestions.map((s) => (
            <li key={s.id} data-testid="suggestion" className="grid gap-2.5 rounded-lg bg-warn-bg/50 p-3 shadow-[inset_0_0_0_1px_rgb(180_83_9/.14)]">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-warn-ink"><Icon name="sparkles" size={13} />Suggested change</p>
              <p className="text-[14px] leading-[22px] text-ink [overflow-wrap:anywhere]">{s.hint}</p>
              {readOnly ? null : (
                <div className="flex flex-wrap gap-2">
                  <Button data-testid="suggestion-accept" size="sm" variant="primary" loading={working === s.id} disabled={working !== null || actions.busy !== null} onClick={() => accept(s.id, s.itemId, s.hint)}>
                    Accept and regenerate
                  </Button>
                  <Button data-testid="suggestion-dismiss" size="sm" variant="secondary" disabled={working !== null} onClick={() => dismiss(s.id)}>Dismiss</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {replies.notes.length === 0 ? (
        <p className="px-4 py-5 text-center text-[14px] text-muted">No replies from this store yet.</p>
      ) : (
        <ul className="divide-y divide-rule-row">
          {replies.notes.map((n) => {
            const c = CATEGORY[n.category] ?? CATEGORY.other;
            return (
              <li key={n.id} data-testid="store-note" data-category={n.category} className="grid gap-1.5 px-4 py-3.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <LogoTile provider={n.provider} size="xs" />
                  <span className="min-w-0 truncate text-[13px] font-medium text-ink-strong">{n.fromName ?? n.fromEmail}</span>
                  <Chip tone={c.tone}>{c.label}</Chip>
                  <span className="ml-auto font-mono text-[11.5px] text-muted">{formatDateTime(n.at)}</span>
                </div>
                <p className="text-[14px] font-medium leading-5 text-ink [overflow-wrap:anywhere]">{n.summary}</p>
                <p className="border-l-2 border-rule pl-3 text-[13px] leading-5 text-ink-2 [overflow-wrap:anywhere]">{n.excerpt}</p>
              </li>
            );
          })}
        </ul>
      )}
      {failed ? <p data-testid="suggestion-error" role="alert" className="px-4 pb-3 text-[13px] text-flag">{failed}</p> : null}
    </CardBand>
  );
}
