"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ButtonLink, CardBand, EmptyState, ErrorState, NoteBox, Pill, Skeleton } from "../ui";
import { Band, Gap, PageHeader } from "../app-ui/frame";
import { Icon } from "../app-ui/icons";
import { SkeletonRows } from "../app-ui/states";
import { formatDate } from "../lib/format";
import { useWorkspace } from "../app/workspace-context";
import { shortChainName } from "../app/shell-controls";
import { BuildButton } from "./build-button";
import { MapLegend, PortfolioMap } from "./portfolio-map";
import { StatusTable } from "./status-table";

/** /app: the chain's week at a glance. The map beside the status table, and the one button that builds the week. */
export function PortfolioView() {
  const router = useRouter();
  const w = useWorkspace();
  const [hot, setHot] = useState<string | null>(null);

  if (w.error && !w.bundle) return <Shell><Band><CardBand title="Portfolio" flush><ErrorState message={w.error.message} onRetry={w.reload} /></CardBand></Band></Shell>;
  if (w.loading || !w.bundle) return <PortfolioSkeleton />;

  const { stores, chain } = w.bundle;
  const editions = w.editions ?? [];
  const isCurrent = w.week === w.currentWeek;
  const count = (s: string) => editions.filter((e) => e.status === s).length;
  const issueNo = editions[0]?.issueNo;
  const open = (id: string) => router.push(`/app/stores/${id}`);
  const name = shortChainName(chain.name);

  if (stores.length === 0) {
    return (
      <Shell>
        <PageHeader pill={<Pill icon={<Icon name="grid" />}>Portfolio</Pill>} title={name} lede="Connect Square or import a store list. Each store gets its own edition, built from the taste of its block." />
        <Gap />
        <Band>
          <CardBand title="Stores" icon={<Icon name="store" />} flush>
            <EmptyState
              icon={<Icon name="store" size={20} />}
              title="No stores yet"
              body="Connect Square or import a store list in setup. Each store gets its own edition, built from the taste of its block."
              action={<ButtonLink href="/onboarding" variant="primary" size="sm" chevron>Set up stores</ButtonLink>}
            />
          </CardBand>
        </Band>
      </Shell>
    );
  }

  const approved = count("approved");
  const flagged = count("flagged");
  const waiting = count("draft") + count("drafting");

  return (
    <Shell>
      <PageHeader
        pill={<Pill icon={<Icon name="calendar" />}>Week of {formatDate(w.week)}{issueNo ? ` · Edition No. ${issueNo}` : ""}</Pill>}
        title={name}
        lede={
          <p className="flex flex-wrap gap-x-1.5">
            <span><b className="font-medium text-ink tnum">{stores.length}</b> stores</span>
            <Sep />
            <Count id="approved" value={approved} label="approved" />
            <Sep />
            <Count id="draft" value={waiting} label={waiting === 1 ? "needs review" : "need review"} />
            <Sep />
            <Count id="flagged" value={flagged} label="flagged" />
          </p>
        }
        actions={isCurrent ? <BuildButton size="lg" /> : <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-stone-100 px-3 text-[14px] text-ink-2"><Icon name="clock" size={14} />A past week, read only</span>}
      />

      {chain.isSample ? (
        <div className="mx-auto max-w-[1192px] border-rule px-2 pt-3 sm:px-3 xl:border-x">
          <NoteBox className="mx-auto">
            <span className="font-medium text-ink">{name} is a sample chain.</span> Its stores, partner places and event listings are made up
            for the demo. Nothing here is a real customer.
          </NoteBox>
        </div>
      ) : null}
      <Gap />

      <Band>
        {w.editionsError ? (
          <CardBand title="This week's editions" flush><ErrorState message={w.editionsError.message} onRetry={w.reloadEditions} /></CardBand>
        ) : (
          <div className="grid gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
            <CardBand title="Stores on the map" actions={<MapLegend />} flush className="xl:h-full" bodyClassName="flex-1 overflow-hidden">
              <PortfolioMap stores={stores} statusOf={(id) => w.editionForStore(id)?.status ?? "none"} hot={hot} onHot={setHot} onOpen={open} />
            </CardBand>
            <div className="min-w-0">
              <StatusTable stores={stores} editionFor={w.editionForStore} hot={hot} onHot={setHot} onOpen={open} loading={w.editionsLoading} />
              {!w.editionsLoading && editions.length === 0 ? (
                <p data-testid="empty-state" className="flex items-start gap-2 px-4 pt-3 text-[14px] leading-5 text-ink-2">
                  <Icon name="info" size={16} className="mt-0.5 shrink-0 text-faint" />
                  {isCurrent
                    ? "No edition yet for this week. Build them: the agent reads each block's taste from Qloo, drafts four items per store and checks every line with guardrails."
                    : `Nothing was built for the week of ${formatDate(w.week)}. Pick another week in the top bar.`}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </Band>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="pt-2">{children}</div>;
}

function Sep() {
  return <span className="text-faint" aria-hidden>·</span>;
}

function Count({ id, value, label }: { id: string; value: number; label: string }) {
  return (
    <span data-testid={`count-${id}`} data-value={value}>
      <b className="font-medium text-ink tnum">{value}</b> {label}
    </span>
  );
}

function PortfolioSkeleton() {
  return (
    <Shell>
      <div role="status" aria-label="Loading the portfolio">
        <Band pad="frame" top={false}>
          <div className="ring-after relative rounded-xl bg-white px-5 pb-9 pt-7 md:px-8">
            <Skeleton className="h-8 w-56 rounded-full" />
            <Skeleton className="mt-6 h-9 w-72" />
            <Skeleton className="mt-4 h-3 w-96 max-w-full rounded-full" />
          </div>
        </Band>
        <Gap />
        <Band>
          <div className="grid gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
            <CardBand title="Stores on the map" icon={<Icon name="map" />} flush><Skeleton className="h-[320px] rounded-lg xl:h-[456px]" /></CardBand>
            <CardBand title="This week's editions" flush><SkeletonRows rows={8} cols={4} /></CardBand>
          </div>
        </Band>
      </div>
    </Shell>
  );
}
