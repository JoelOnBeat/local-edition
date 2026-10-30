"use client";

import { useState } from "react";
import type { CalendarFeed } from "@/contract";
import { Chip, buttonClass, cx } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { CalendarPreview, ToolTile } from "./tool-tile";

/** The calendar feed: nothing to authorise, just a private link that Google or Outlook Calendar subscribes to. */

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button data-testid="cal-copy" type="button" onClick={copy} className={buttonClass("ghost", "sm")}>
      <Icon name={state === "copied" ? "check" : "copy"} size={14} />
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy link"}
    </button>
  );
}

function FeedLinks({ feed }: { feed: CalendarFeed }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a data-testid="cal-google" href={feed.googleUrl} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>Add to Google Calendar</a>
      <a data-testid="cal-outlook" href={feed.outlookUrl} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>Add to Outlook</a>
      <CopyButton text={feed.url} />
    </div>
  );
}

export function CalendarCard({ feeds }: { feeds: CalendarFeed[] }) {
  const chain = feeds.find((f) => f.scope === "chain");
  const stores = feeds.filter((f) => f.scope === "store");
  const total = chain?.eventCount ?? stores.reduce((a, f) => a + f.eventCount, 0);
  const [open, setOpen] = useState(false);

  return (
    <ToolTile
      provider="calendar"
      testId="conn-card-calendar"
      dataStatus={feeds.length ? "connected" : "not_connected"}
      preview={<CalendarPreview count={total} />}
      status={<Chip tone={feeds.length ? "ok" : "neutral"} dot={feeds.length > 0}>{feeds.length ? "Feed ready" : "No feed yet"}</Chip>}
    >
      <div className="grid gap-1">
        <h3 className="text-[14px] font-medium leading-5 text-ink">Google and Outlook Calendar</h3>
        <p className="text-[14px] leading-5 text-ink-2">A private feed of approved event nights: subscribe once and new nights appear as head office approves them. Anyone with the link sees the feed, so keep it inside the team.</p>
      </div>

      {feeds.length === 0 ? (
        <p className="flex gap-2 rounded-lg bg-paper-2 px-3 py-2.5 text-[13px] leading-5 text-ink-2 shadow-[inset_0_0_0_1px_var(--rule-subtle)]">
          <Icon name="info" size={14} className="mt-[3px] shrink-0 text-faint" />
          The feed appears once an edition with an event night is approved.
        </p>
      ) : (
        <>
          {chain ? (
            <div className="grid gap-2.5">
              <p className="text-[13px] leading-5 text-ink-2">
                <span className="font-medium text-ink-strong" data-testid="cal-event-count" data-count={total}>Every store</span> · <span className="tnum">{total}</span> {total === 1 ? "event night" : "event nights"} in the feed
              </p>
              <FeedLinks feed={chain} />
            </div>
          ) : null}
          {stores.length ? (
            <div className="rounded-lg shadow-[inset_0_0_0_1px_var(--rule)]">
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-ink-2 transition-colors hover:bg-stone-50", open && "bg-stone-50")}>
                <Icon name="chevronRight" size={14} className={cx("shrink-0 text-faint transition-transform duration-200", open && "rotate-90")} />
                One feed per store <span className="text-muted tnum">({stores.length})</span>
              </button>
              {open ? (
                <ul className="le-pop divide-y divide-rule-row border-t border-rule-subtle">
                  {stores.map((f) => (
                    <li key={f.url} className="grid gap-2 px-3 py-3">
                      <p className="text-[13px] font-medium text-ink-strong">{f.label} <span className="font-normal text-muted tnum">· {f.eventCount}</span></p>
                      <FeedLinks feed={f} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </ToolTile>
  );
}
