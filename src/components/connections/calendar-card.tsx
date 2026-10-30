"use client";

import { useState } from "react";
import type { CalendarFeed } from "@/contract";
import { Card, Chip, EmptyState, ProviderBadge, buttonClass } from "@/components/ui";

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

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-5" data-testid="conn-card-calendar" data-status={feeds.length ? "connected" : "not_connected"}>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ProviderBadge provider="calendar" label="Google and Outlook Calendar" className="text-[15px] font-semibold text-ink [&>span:first-child]:h-6 [&>span:first-child]:min-w-6 [&>span:first-child]:text-[11px]" />
          <Chip tone={feeds.length ? "ok" : "neutral"} dot>{feeds.length ? "Feed ready" : "No feed yet"}</Chip>
        </div>
        <p className="text-[13.5px] text-muted">
          A private feed of approved event nights. Subscribe once; new events appear as head office approves them.
        </p>
      </div>

      {feeds.length === 0 ? (
        <EmptyState title="No event nights yet" body="The feed appears once an edition with an event night is approved." className="py-6" />
      ) : (
        <>
          {chain ? (
            <div className="grid gap-2">
              <p className="text-[14px] text-ink">
                <span className="font-semibold" data-testid="cal-event-count" data-count={total}>Every store</span> · {total} {total === 1 ? "event night" : "event nights"} in the feed
              </p>
              <FeedLinks feed={chain} />
            </div>
          ) : null}
          {stores.length ? (
            <details className="group rounded-[var(--radius)] border border-rule">
              <summary className="cursor-pointer list-none px-3 py-2 text-[13.5px] font-medium text-ink-2 marker:hidden">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>
                One feed per store ({stores.length})
              </summary>
              <ul className="divide-y divide-rule border-t border-rule">
                {stores.map((f) => (
                  <li key={f.url} className="grid gap-2 px-3 py-3">
                    <p className="text-[13.5px] text-ink">
                      {f.label} <span className="font-mono text-[12px] text-muted">· {f.eventCount}</span>
                    </p>
                    <FeedLinks feed={f} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="text-[12.5px] text-muted">Treat these links as private: anyone with one can see that feed&apos;s events.</p>
        </>
      )}
    </Card>
  );
}
