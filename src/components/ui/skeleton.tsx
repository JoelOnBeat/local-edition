import { cx } from "./cx";

/** Shimmering placeholder block. Size it with className (h-4 w-32 …). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx("rounded-[var(--radius)]", className)}
      style={{
        background: "linear-gradient(90deg, var(--paper-2) 0%, color-mix(in oklab, var(--rule) 70%, var(--paper-2)) 50%, var(--paper-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "le-shimmer 1.6s linear infinite",
      }}
    />
  );
}

/** A few lines of text-shaped skeleton. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("space-y-2", className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
