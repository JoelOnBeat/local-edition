import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { Icon } from "./icons";

/**
 * The stepper list (DESIGN-SYSTEM §9): each step hangs off a 28px plate counter, joined to the next by a dashed stone-300
 * line at x 13.5px. Done shows a check in ok-ink, skipped a dash, the current step is ringed in flame.
 */

export type StepState = "done" | "skipped" | "todo" | "current";

export function StepCounter({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-[12px] font-semibold leading-none tnum",
        state === "current" ? "text-accent-text shadow-[0_0_0_1.5px_var(--accent),0_1px_2px_rgba(25,28,33,.06)]" : "shadow-plate",
        state === "current" ? "" : state === "skipped" ? "text-faint" : "text-ink-2",
      )}
    >
      {state === "done" ? <Icon name="check" size={14} strokeWidth={2.4} className="text-ok-ink" /> : state === "skipped" ? <Icon name="minus" size={14} /> : n}
    </span>
  );
}

/** One step: counter + connector on the left, the row (usually a button) and its expanded body on the right. */
export function StepItem({ n, state, last, row, children, className }: {
  n: number;
  state: StepState;
  last?: boolean;
  row: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <li className={cx("relative pl-[44px]", !last && "pb-2", className)}>
      <span className="absolute left-0 top-[10px]"><StepCounter n={n} state={state} /></span>
      {!last ? <span aria-hidden className="absolute bottom-0 left-[13.5px] top-[42px] border-l border-dashed border-stone-300" /> : null}
      {row}
      {children}
    </li>
  );
}

/** The 12/500 status word at the end of a step row. */
export function StepStatusWord({ state, optional }: { state: StepState; optional?: boolean }) {
  const label = state === "done" ? "Done" : state === "skipped" ? "Skipped" : optional ? "Optional" : "To do";
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[12px] font-medium leading-4",
        state === "done" ? "bg-ok-bg text-ok-strong" : state === "skipped" ? "bg-stone-100 text-muted" : "bg-white text-ink-2 shadow-ring-xs",
      )}
    >
      {label}
    </span>
  );
}
