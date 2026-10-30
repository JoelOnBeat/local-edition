import type { ReactNode } from "react";
import { cx } from "./cx";
import { storeColor } from "./store-swatch";

/**
 * The front-page masthead of a store edition: a store-coloured rule, the title in display type,
 * and a dateline row (issue number, week, address). `actions` sits at the right of the dateline.
 */
export function Masthead({
  title, kicker, issueNo, dateline, colorIndex, actions, size = "lg", className,
}: {
  title: string;
  kicker?: ReactNode;
  issueNo?: number;
  dateline?: ReactNode;
  colorIndex?: number;
  actions?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <header className={cx("w-full", className)}>
      <div className="h-1.5 w-full" style={{ background: colorIndex ? storeColor(colorIndex) : "var(--ink)" }} aria-hidden />
      <div className="flex items-baseline justify-between gap-4 pt-3">
        {kicker ? <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{kicker}</p> : <span />}
        {issueNo !== undefined ? <p className="font-mono text-[12px] text-muted">No. {issueNo}</p> : null}
      </div>
      <h1
        className={cx(
          "font-display font-bold leading-[0.95] tracking-[-0.02em] text-ink [overflow-wrap:anywhere]",
          size === "lg" ? "mt-1 text-[40px] sm:text-[56px] lg:text-[72px]" : "mt-1 text-3xl sm:text-4xl",
        )}
      >
        {title}
      </h1>
      <div className="rule-double mt-3" />
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule py-2 text-[13px] text-ink-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{dateline}</div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A dot separator for datelines. */
export function Dot() {
  return <span className="text-rule" aria-hidden>·</span>;
}
