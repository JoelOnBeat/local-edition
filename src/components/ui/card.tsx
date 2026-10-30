import type { ComponentProps } from "react";
import { cx } from "./cx";

/** A paper panel with a hairline border. `inset` uses the second paper tone. */
export function Card({ className, inset, ...rest }: ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      className={cx("rounded-[var(--radius)] border border-rule", inset ? "bg-paper-2" : "bg-paper", className)}
      {...rest}
    />
  );
}

/** Small-caps section label used above editorial blocks ("THE SPECIAL", "ON THE SPEAKERS"). */
export function Kicker({ className, ...rest }: ComponentProps<"p">) {
  return <p className={cx("text-[11px] font-semibold uppercase tracking-[0.14em] text-muted", className)} {...rest} />;
}
