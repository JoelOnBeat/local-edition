import type { ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";

/** Nothing to show yet, said plainly, with the one action that fixes it. */
export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-start gap-3 rounded-[var(--radius)] border border-dashed border-rule px-6 py-10", className)}>
      <p className="font-display text-xl font-semibold tracking-tight text-ink">{title}</p>
      {body ? <div className="max-w-prose text-sm text-muted">{body}</div> : null}
      {action}
    </div>
  );
}

/** Something failed. Shows the server's plain message and a retry. */
export function ErrorState({ title = "This did not load", message, onRetry, className }: { title?: string; message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cx("flex flex-col items-start gap-3 rounded-[var(--radius)] border px-6 py-8", className)}
      style={{ borderColor: "color-mix(in oklab, var(--flag) 40%, var(--rule))", background: "color-mix(in oklab, var(--flag) 5%, var(--paper))" }}>
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      <p className="max-w-prose text-sm text-ink-2">{message}</p>
      {onRetry ? <Button size="sm" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

/** Inline notice strip: info, warn or flag tone. */
export function Notice({ tone = "info", children, action, className }: { tone?: "info" | "warn" | "flag" | "ok"; children: ReactNode; action?: ReactNode; className?: string }) {
  const color = `var(--${tone})`;
  return (
    <div role={tone === "flag" ? "alert" : "status"}
      className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius)] border px-4 py-3 text-sm text-ink", className)}
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, var(--rule))`, background: `color-mix(in oklab, ${color} 8%, var(--paper))` }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
