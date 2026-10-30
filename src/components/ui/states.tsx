import type { ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";

function Well({ tone, children }: { tone?: "flag"; children: ReactNode }) {
  return (
    <span className={cx("flex size-10 items-center justify-center rounded-[10px] bg-well shadow-[inset_0_0_0_1px_var(--well-ring)]", tone === "flag" ? "text-flag" : "text-faint")} aria-hidden>
      {children}
    </span>
  );
}

/** Nothing to show yet, said plainly, with the one action that fixes it. Centred, no dashed border. */
export function EmptyState({ title, body, action, icon, className }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div data-testid="empty-state" className={cx("flex flex-col items-center px-6 py-14 text-center", className)}>
      <Well>
        {icon ?? <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3.5" y="4" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M3.5 8h13M7 11.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
      </Well>
      <p className="mt-4 text-[16px] font-medium leading-6 text-ink">{title}</p>
      {body ? <div className="mt-1 max-w-[360px] text-[14px] leading-5 text-ink-2">{body}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Something failed. Shows the server's plain message and a retry. */
export function ErrorState({ title = "This did not load", message, onRetry, className }: { title?: string; message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" data-testid="error-state" className={cx("flex flex-col items-center px-6 py-14 text-center", className)}>
      <Well tone="flag">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3.5 17 16H3l7-12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M10 8.5v3M10 13.8h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </Well>
      <p className="mt-4 text-[16px] font-medium leading-6 text-ink">{title}</p>
      <p className="mt-1 max-w-[420px] text-[14px] leading-5 text-ink-2">{message}</p>
      {onRetry ? <Button size="sm" className="mt-5" data-testid="error-retry" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

const NOTICE: Record<"info" | "warn" | "flag" | "ok", { bar: string; icon: string }> = {
  info: { bar: "bg-faint", icon: "text-faint" },
  ok: { bar: "bg-ok", icon: "text-ok-ink" },
  warn: { bar: "bg-warn", icon: "text-warn-ink" },
  flag: { bar: "bg-flag", icon: "text-flag" },
};

/** Inline notice in the note-box style: a white plate in a soft grey well, a 4px tone bar and the message. */
export function Notice({ tone = "info", children, action, className, "data-testid": testId }: { tone?: "info" | "warn" | "flag" | "ok"; children: ReactNode; action?: ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <div role={tone === "flag" ? "alert" : "status"} data-testid={testId} data-tone={tone} className={cx("rounded-2xl bg-black/[.055] p-1", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-white px-4 py-3 text-[14px] leading-5 text-ink-2 shadow-plate">
        <span className={cx("h-3.5 w-1 shrink-0 rounded-full", NOTICE[tone].bar)} aria-hidden />
        <div className="min-w-0 flex-1">{children}</div>
        {action}
      </div>
    </div>
  );
}
