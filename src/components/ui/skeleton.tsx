import { cx } from "./cx";

/** Shimmering placeholder block (#EFEFEF, 1.25s). Size it with className (h-4 w-32 …). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("le-skeleton rounded-md", className)} />;
}

/** A few lines of text-shaped skeleton. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("space-y-2.5", className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-2.5 rounded-full", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
