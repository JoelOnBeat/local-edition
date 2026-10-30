import type { EditionReview, Store } from "@/contract";
import { CardBand, StoreTile } from "../ui";
import { Icon } from "../app-ui/icons";
import { IconTag } from "../app-ui/status";
import { LogoTile } from "../app-ui/tiles";
import { isNvidia } from "./store-chip";
import { formatDate, modelName } from "../lib/format";

/**
 * The portfolio reviewer's verdict on this edition, as a rail card. On the sample chain the note is the review of the sample's
 * own editions (one real Ultra read, copied into every sample workspace), and says so with the date it was read.
 */
export function ReviewNote({ review, storeById, sample = false }: { review: EditionReview | null | undefined; storeById: (id: string) => Store | undefined; sample?: boolean }) {
  if (!review) {
    return (
      <CardBand data-testid="review-note" data-verdict="none" title="Reviewer's note" icon={<Icon name="sparkles" />} actions={<IconTag icon="clock">Not yet</IconTag>}>
        <p className="text-[14px] leading-[22px] text-ink-2">
          The portfolio reviewer has not read this edition yet. It reads every store side by side and flags editions that repeat each other.
        </p>
      </CardBand>
    );
  }
  const ok = review.verdict === "approve";
  return (
    <CardBand
      data-testid="review-note"
      data-verdict={review.verdict}
      title="Reviewer's note"
      icon={<Icon name="sparkles" />}
      actions={ok ? <IconTag tone="ok" icon="check">Clears</IconTag> : <IconTag tone="warn" icon="pencil">Wants a change</IconTag>}
      footer={
        <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex min-w-0 items-center gap-2">
            {isNvidia(review.reviewedBy) ? <LogoTile provider="nemotron" size="xs" /> : null}
            <span className="truncate font-mono text-[12px] text-ink-2">{modelName(review.reviewedBy)}</span>
          </span>
          <span data-testid="review-note-date" className="text-[12px] text-muted">{sample ? "Sample chain's review" : "Reviewed"}, {formatDate(review.at)}</span>
        </span>
      }
    >
      <p className="text-[14px] leading-[22px] text-ink-2 [overflow-wrap:anywhere]">{review.reason}</p>
      {review.hint ? (
        <p className="mt-3 rounded-lg bg-warn-bg/60 px-3 py-2.5 text-[14px] leading-[22px] text-ink shadow-[inset_0_0_0_1px_rgb(180_83_9/.12)] [overflow-wrap:anywhere]">
          {review.hint}
        </p>
      ) : null}
      {review.clashWith.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          Repeats
          {review.clashWith.map((id) => {
            const s = storeById(id);
            return s ? (
              <span key={id} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rule bg-white pl-1 pr-2 text-[13px] font-medium text-ink-strong">
                <StoreTile colorIndex={s.colorIndex} name={s.name} size="sm" />
                {s.name}
              </span>
            ) : <span key={id} className="font-mono text-[12px]">{id}</span>;
          })}
        </div>
      ) : null}
    </CardBand>
  );
}
