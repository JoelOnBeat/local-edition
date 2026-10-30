import { cx } from "./cx";

const CELLS = [0, 14.667, 29.333];

/** The Local Edition mark: a 3×3 city block with the flame store in the middle. `dark` for dark bands. */
export function LogoMark({ size = 24, dark, className }: { size?: number; dark?: boolean; className?: string }) {
  const ink = dark ? "#FAFAFA" : "#171717";
  return (
    <svg viewBox="0 0 42 42" width={size} height={size} className={cx("shrink-0", className)} aria-hidden>
      <defs><clipPath id={dark ? "le-mark-d" : "le-mark-l"}><rect width="42" height="42" rx="9" /></clipPath></defs>
      <g clipPath={`url(#${dark ? "le-mark-d" : "le-mark-l"})`}>
        {CELLS.flatMap((y) => CELLS.map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="12.667" height="12.667" fill={x === 14.667 && y === 14.667 ? "#F15A0F" : ink} />
        )))}
      </g>
    </svg>
  );
}

/** Mark + "Local Edition" in Geist 500. `size="sm"` is the 16px focused-layout lockup. */
export function Lockup({ size = "md", dark, className }: { size?: "sm" | "md"; dark?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center", size === "sm" ? "gap-2" : "gap-2.5", className)}>
      <LogoMark size={size === "sm" ? 20 : 22} dark={dark} />
      <span className={cx("font-medium tracking-[-0.02em]", size === "sm" ? "text-[16px] leading-6" : "text-[19px] leading-7", dark ? "text-band-ink" : "text-ink")}>
        Local Edition
      </span>
    </span>
  );
}
