import type { BlockProfile } from "@/contract";
import { SkeletonText, storeColor } from "../ui";

/** The block's top tags by lift over the city, as a short ranked column. */
export function BlockTaste({ profile, loading, colorIndex }: { profile?: BlockProfile; loading: boolean; colorIndex: number }) {
  return (
    <section>
      <p className="border-b border-ink pb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">The block this week</p>
      {loading && !profile ? (
        <SkeletonText lines={5} className="mt-3" />
      ) : !profile || profile.tags.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Qloo returned no taste signal for this block yet.</p>
      ) : (
        <ul className="mt-1">
          {profile.tags.slice(0, 6).map((t) => {
            const max = Math.max(...profile.tags.map((x) => x.lift), 0.01);
            return (
              <li key={t.tagId} className="border-b border-rule py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13.5px] text-ink">{t.name}</span>
                  <span className="shrink-0 font-mono text-[12px] text-ink-2">+{t.lift.toFixed(2)}</span>
                </div>
                <div className="mt-1 h-1 w-full rounded-full bg-paper-2">
                  <div className="h-1 rounded-full" style={{ width: `${Math.max(4, (t.lift / max) * 100)}%`, background: storeColor(colorIndex) }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-muted">Lift over the New York baseline · Qloo</p>
    </section>
  );
}
