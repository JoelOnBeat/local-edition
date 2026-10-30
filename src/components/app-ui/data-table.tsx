import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/components/ui";
import { Icon } from "./icons";

/**
 * ByDefault's data table: column headers sit on the stone-50 frame, rows on a white plate (57px, stone-100 hairlines,
 * stone-50/70 hover, an arrow that fades in), a footer strip below. Rows are CSS grids sharing one `grid` template, so
 * columns drop by breakpoint and nothing scrolls sideways.
 */
export function DataTable({ head, grid, children, footer, className, label, elevated, testId }: {
  head: { label: ReactNode; className?: string }[];
  grid: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  label: string;
  elevated?: boolean;
  testId?: string;
}) {
  return (
    <section
      role="table"
      aria-label={label}
      data-testid={testId}
      className={cx("flex min-w-0 flex-col rounded-xl bg-paper-2 p-1 pt-0", elevated ? "shadow-ring-md" : "shadow-ring-xs", className)}
    >
      <div role="row" className={cx("grid min-h-[52px] items-center gap-x-4 px-4 pb-3 pt-4 text-[14px] font-medium leading-5 text-ink-strong", grid)}>
        {head.map((h, i) => (
          <span role="columnheader" key={i} className={cx("min-w-0 truncate", h.className)}>{h.label}</span>
        ))}
      </div>
      <div role="rowgroup" className="relative z-[1] min-w-0 overflow-hidden rounded-lg bg-white shadow-ring-xs">{children}</div>
      {footer ? <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-1 pt-2.5 text-[14px] leading-5 text-ink-2">{footer}</div> : null}
    </section>
  );
}

/** One row. Pass `onClick` for a clickable row (arrow on hover); `selected` tints it like ByDefault's own-brand row. */
export function DataRow({ grid, children, onClick, selected, className, arrow = true, ...rest }: {
  grid: string;
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  arrow?: boolean;
} & Omit<ComponentProps<"div">, "onClick" | "children">) {
  return (
    <div
      role="row"
      onClick={onClick}
      className={cx(
        "group/row relative grid min-h-[57px] items-center gap-x-4 border-b border-rule-row px-4 py-3 text-[14px] font-medium leading-5 text-ink-strong last:border-b-0",
        onClick && "cursor-pointer transition-colors duration-150 hover:bg-row-hover",
        selected && "bg-stone-50",
        arrow && onClick && "pr-9",
        grid,
        className,
      )}
      {...rest}
    >
      {children}
      {onClick && arrow ? (
        <Icon name="arrowRight" size={14} className="pointer-events-none absolute right-3.5 top-1/2 -translate-x-1 -translate-y-1/2 text-faint opacity-0 transition-[opacity,translate] duration-150 group-hover/row:translate-x-0 group-hover/row:opacity-100" />
      ) : null}
    </div>
  );
}

export function Cell({ className, children, ...rest }: ComponentProps<"div">) {
  return <div role="cell" className={cx("min-w-0", className)} {...rest}>{children}</div>;
}
