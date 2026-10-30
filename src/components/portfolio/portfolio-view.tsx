"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ButtonLink, EmptyState, ErrorState, Skeleton, SkeletonText } from "../ui";
import { formatDate } from "../lib/format";
import { useWorkspace } from "../app/workspace-context";
import { BuildButton } from "./build-button";
import { PortfolioMap } from "./portfolio-map";
import { StatusTable } from "./status-table";

/** /app: the calm map plus the status table, and the one button that builds the week. */
export function PortfolioView() {
  const router = useRouter();
  const w = useWorkspace();
  const [hot, setHot] = useState<string | null>(null);

  if (w.error && !w.bundle) return <ErrorState message={w.error.message} onRetry={w.reload} />;
  if (w.loading || !w.bundle) return <PortfolioSkeleton />;

  const stores = w.bundle.stores;
  const editions = w.editions ?? [];
  const isCurrent = w.week === w.currentWeek;
  const count = (s: string) => editions.filter((e) => e.status === s).length;
  const issueNo = editions[0]?.issueNo;
  const open = (id: string) => router.push(`/app/stores/${id}`);

  if (stores.length === 0) {
    return (
      <EmptyState
        title="No stores yet"
        body="Connect Square or import a store list in Setup. Each store gets its own edition, built from the taste of its block."
        action={<ButtonLink href="/app/setup" variant="primary">Go to Setup</ButtonLink>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-5 border-b border-ink pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Portfolio · week of {formatDate(w.week)}{issueNo ? ` · Issue ${issueNo}` : ""}
          </p>
          <h1 className="mt-1 font-display text-[34px] font-bold leading-[1] tracking-[-0.02em] sm:text-[44px]">
            {stores.length} stores, {editions.length ? `${editions.length} editions` : "no editions yet"}
          </h1>
          {editions.length ? (
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              <Stat id="approved" label="Approved" value={count("approved")} color="var(--ok)" />
              <Stat id="flagged" label="Flagged" value={count("flagged")} color="var(--flag)" />
              <Stat id="draft" label="Waiting on you" value={count("draft") + count("drafting")} color="var(--muted)" />
            </dl>
          ) : null}
        </div>
        {isCurrent ? <BuildButton size="lg" /> : <p className="text-sm text-muted">A past week. Editions are read only.</p>}
      </section>

      {w.editionsError ? <ErrorState message={w.editionsError.message} onRetry={w.reloadEditions} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <PortfolioMap
          stores={stores}
          statusOf={(id) => w.editionForStore(id)?.status ?? "none"}
          hot={hot}
          onHot={setHot}
          onOpen={open}
        />
        <div className="min-w-0">
          {w.editionsLoading ? (
            <SkeletonText lines={8} />
          ) : (
            <>
              <StatusTable stores={stores} editionFor={w.editionForStore} hot={hot} onHot={setHot} onOpen={open} />
              {editions.length === 0 ? (
                <EmptyState
                  className="mt-4"
                  title={isCurrent ? "This week has no editions yet" : `No editions for the week of ${formatDate(w.week)}`}
                  body={isCurrent
                    ? "Build them now. The agent reads each block's taste from Qloo, drafts four items per store, and checks every line with guardrails."
                    : "Nothing was built that week. Pick another week above."}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ id, label, value, color }: { id: string; label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-2" data-testid={`count-${id}`} data-value={value}>
      <dd className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: value ? color : "var(--muted)" }}>{value}</dd>
      <dt className="text-[13px] text-ink-2">{label}</dt>
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading the portfolio">
      <div className="space-y-3 border-b border-rule pb-5">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-6 w-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Skeleton className="h-[340px] lg:h-[520px]" />
        <SkeletonText lines={9} />
      </div>
    </div>
  );
}
