import { cx } from "./cx";

/** The CSS variable for a store's colour. Every store keeps one colour everywhere. */
export const storeColor = (colorIndex: number): string => `var(--store-${((Math.max(1, colorIndex) - 1) % 8) + 1})`;

/** A store's colour square, optionally with its name. */
export function StoreSwatch({ colorIndex, name, size = "md", className }: { colorIndex: number; name?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "sm" ? "h-2.5 w-2.5" : size === "lg" ? "h-4 w-4" : "h-3 w-3";
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-2", className)}>
      <span className={cx(box, "shrink-0 rounded-[2px]")} style={{ background: storeColor(colorIndex) }} aria-hidden />
      {name ? <span className="truncate">{name}</span> : null}
    </span>
  );
}
