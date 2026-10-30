import type { EditionReview, Store } from "@/contract";
import { StoreSwatch } from "../ui";
import { modelName } from "../lib/format";

/** The Ultra reviewer's verdict, set like an editor's note in the margin. */
export function ReviewNote({ review, storeById }: { review: EditionReview | null | undefined; storeById: (id: string) => Store | undefined }) {
  if (!review) {
    return (
      <aside className="rounded-[var(--radius)] border border-dashed border-rule p-4 text-[13px] text-muted">
        The portfolio reviewer has not read this edition yet. It reads every store side by side and flags editions that repeat each other.
      </aside>
    );
  }
  const ok = review.verdict === "approve";
  return (
    <aside className="rounded-[var(--radius)] border p-4" style={{ borderColor: ok ? "var(--rule)" : "color-mix(in oklab, var(--warn) 50%, var(--rule))", background: ok ? "var(--paper-2)" : "color-mix(in oklab, var(--warn) 7%, var(--paper))" }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Reviewer&apos;s note</p>
      <p className="mt-1 font-display text-[19px] font-semibold leading-tight" style={{ color: ok ? "var(--ink)" : "var(--warn)" }}>
        {ok ? "Clears the desk" : "Needs a change"}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{review.reason}</p>
      {review.hint ? <p className="mt-2 border-l-2 border-warn pl-3 text-[13.5px] leading-relaxed text-ink">{review.hint}</p> : null}
      {review.clashWith.length ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          Repeats:
          {review.clashWith.map((id) => {
            const s = storeById(id);
            return s ? <StoreSwatch key={id} colorIndex={s.colorIndex} name={s.name} size="sm" className="text-ink" /> : <span key={id}>{id}</span>;
          })}
        </p>
      ) : null}
      <p className="mt-3 font-mono text-[11px] text-muted">{modelName(review.reviewedBy)}</p>
    </aside>
  );
}
