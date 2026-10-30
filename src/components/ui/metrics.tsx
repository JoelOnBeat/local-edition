import { cx } from "./cx";

/* bg-ok bg-warn bg-flag bg-rule */
/** Threshold colour for a 0–100 value: ≥70 ok, 40–69 warn, <40 flag. */
export const levelClass = (v: number): string => (v >= 70 ? "bg-ok" : v >= 40 ? "bg-warn" : "bg-flag");

/** A 4×14 status bar followed by its value (ByDefault's visibility bar). */
export function StatusBar({ value, label, tone, className }: { value: number; label?: string; tone?: "ok" | "warn" | "flag" | "none"; className?: string }) {
  const bar = tone === "none" ? "bg-rule" : tone ? `bg-${tone}` : levelClass(value);
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[14px] font-medium leading-5 text-ink-strong tnum", className)}>
      <span className={cx("h-3.5 w-1 shrink-0 rounded-full", bar)} aria-hidden />
      {label ?? `${Math.round(value)}%`}
    </span>
  );
}

/** Five-pill strength meter. `weak` uses lime fills. */
export function SignalMeter({ value, max = 5, weak, label, className }: { value: number; max?: number; weak?: boolean; label?: string; className?: string }) {
  const filled = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <span className={cx("inline-flex items-center gap-0.5", className)} role="img" aria-label={label ?? `Strength ${filled} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cx("h-4 w-[5px] rounded-full", i < filled ? (weak ? "bg-ok-lime" : "bg-ok-meter") : "bg-rule")} />
      ))}
    </span>
  );
}

/** Up/down delta with a small arrow. `null` shows the em-dash for a missing value. */
export function Delta({ value, format = (v) => v.toFixed(2), suffix, className }: { value: number | null | undefined; format?: (v: number) => string; suffix?: string; className?: string }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className={cx("text-[12px] text-empty", className)}>—</span>;
  const up = value >= 0;
  return (
    <span className={cx("inline-flex items-center gap-0.5 text-[14px] font-medium leading-5 tnum", up ? "text-ok-ink" : "text-flag", className)}>
      <svg className="size-3" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d={up ? "M6 9.5v-7M3 5.5l3-3 3 3" : "M6 2.5v7M3 6.5l3 3 3-3"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {up ? "+" : "−"}{format(Math.abs(value))}{suffix}
    </span>
  );
}
