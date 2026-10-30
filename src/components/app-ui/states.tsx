import { cx } from "@/components/ui";

/** Loading, empty and error states inside a card body (DESIGN-SYSTEM §9: empty state, error state, skeleton). */

export function Skel({ className }: { className?: string }) {
  return <span aria-hidden className={cx("le-skeleton block rounded-md", className)} />;
}

/** Table-shaped skeleton: tile + two bars per row. */
export function SkeletonRows({ rows = 6, cols = 3, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cx("divide-y divide-rule-row", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-[18px]">
          <Skel className="size-6 shrink-0" />
          <Skel className="h-2.5 w-full max-w-[180px]" />
          {Array.from({ length: Math.max(0, cols - 1) }, (_, j) => (
            <Skel key={j} className={cx("ml-auto h-2.5 w-14", j > 0 && "hidden sm:block")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Three bouncing dots for "the agent is thinking". */
export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1", className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="le-live-dot size-1 rounded-full bg-current" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}
