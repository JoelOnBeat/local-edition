import type { ReactNode } from "react";
import { Pill } from "./chip";
import { cx } from "./cx";
import { StoreTile } from "./store-swatch";

/**
 * Page header for a store edition (was the newspaper masthead): a pill for the kicker and issue number, a 36/40 heading
 * with the store's tile inline, a caption line for the dateline, and actions on the right.
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
  const pill = [kicker, issueNo !== undefined ? `No. ${issueNo}` : null].filter(Boolean);
  return (
    <header className={cx("w-full", className)}>
      {pill.length ? (
        <Pill>
          {pill.map((p, i) => (
            <span key={i}>{i > 0 ? <span className="px-1.5 text-faint">·</span> : null}{p}</span>
          ))}
        </Pill>
      ) : null}
      <h1
        className={cx(
          "flex min-w-0 items-center gap-3 font-medium tracking-[-0.02em] text-ink [overflow-wrap:anywhere]",
          pill.length ? "mt-5" : "",
          size === "lg" ? "text-[30px] leading-[36px] sm:text-[36px] sm:leading-[40px]" : "text-[28px] leading-[34px]",
        )}
      >
        {colorIndex ? <StoreTile colorIndex={colorIndex} name={title} size="lg" className="-rotate-1" /> : null}
        <span className="min-w-0">{title}</span>
      </h1>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5 text-muted">{dateline}</div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A dot separator for datelines. */
export function Dot() {
  return <span className="text-faint" aria-hidden>·</span>;
}
