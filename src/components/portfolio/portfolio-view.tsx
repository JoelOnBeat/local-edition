"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ButtonLink, CardBand, EmptyState, ErrorState, Pill, Skeleton } from "../ui";
import { Band, Gap, Page, PageHeader } from "../app-ui/frame";
import { Icon } from "../app-ui/icons";
import { SkeletonRows } from "../app-ui/states";
import { formatDate } from "../lib/format";
import { useWorkspace } from "../app/workspace-context";
import { WeekPicker, shortChainName } from "../app/shell-controls";
import { LastRunCard } from "../runs/last-run-card";
import { BuildButton } from "./build-button";
import { PortfolioFilters, matches, type Filter } from "./portfolio-filters";
import { MapLegend, PortfolioMap } from "./portfolio-map";
import { StatusTable } from "./status-table";

/** /app: the chain's week at a glance. Counts that filter, a search, the map beside the table, one primary action. */
export function PortfolioView() {
  const router = useRouter();
  const w = useWorkspace();
  const [hot, setHot] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  if (w.error && !w.bundle) return <Page><Band grow><CardBand title="Portfolio" flush><ErrorState message={w.error.message} onRetry={w.reload} /></CardBand></Band></Page>;
  if (w.loading || !w.bundle) return <PortfolioSkeleton />;

  const { stores, chain } = w.bundle;
  const editions = w.editions ?? [];
  const isCurrent = w.week === w.currentWeek;
  const issueNo = editions[0]?.issueNo;
  const open = (id: string) => router.push(`/app/stores/${id}`);
  const name = shortChainName(chain.name);
  const pill = <Pill icon={<Icon name="grid" />}>Portfolio{issueNo ? ` · Edition No. ${issueNo}` : ""}</Pill>;
  const actions = (
    <>
      <WeekPicker />
      {isCurrent ? <BuildButton size="lg" /> : <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-stone-100 px-3 text-[14px] text-ink-2"><Icon name="clock" size={14} />Past week, read only</span>}
    </>
  );

  if (stores.length === 0) {
    return (
      <Page>
        <PageHeader pill={pill} title={name} lede="No stores yet." />
        <Gap />
        <Band grow>
          <CardBand title="Stores" icon={<Icon name="store" />} flush className="flex-1" bodyClassName="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Icon name="store" size={20} />}
              title="No stores yet"
              body="Connect Square or import a store list. Each store gets its own edition, built from the taste of its block."
              action={<ButtonLink href="/app/setup" variant="primary" size="sm" chevron>Set up stores</ButtonLink>}
            />
          </CardBand>
        </Band>
      </Page>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = stores.filter((s) => {
    const e = w.editionForStore(s.id);
    if (!matches(filter, e)) return false;
    if (!q) return true;
    const special = e?.items.find((i) => i.kind === "special");
    return [s.name, s.addressLabel, special && special.kind === "special" ? special.name : ""].some((t) => t.toLowerCase().includes(q));
  });
  const built = editions.length;

  return (
    <Page>
      <PageHeader
        pill={pill}
        title={name}
        lede={built ? `${stores.length} stores, one edition each, built from the taste of its block.` : `${stores.length} stores. No editions for this week yet.`}
        actions={actions}
      />
      <Gap />
      <Band grow>
        {w.editionsError ? (
          <CardBand title="This week's editions" flush><ErrorState message={w.editionsError.message} onRetry={w.reloadEditions} /></CardBand>
        ) : (
          <div className="grid gap-4">
            <PortfolioFilters stores={stores} editionFor={w.editionForStore} filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} />
            <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
              <div className="grid content-start gap-3">
                <CardBand title="Stores on the map" actions={<MapLegend />} flush bodyClassName="overflow-hidden">
                  <PortfolioMap stores={shown} statusOf={(id) => w.editionForStore(id)?.status ?? "none"} hot={hot} onHot={setHot} onOpen={open} />
                </CardBand>
                <LastRunCard />
              </div>
              <StatusTable
                stores={shown}
                total={stores.length}
                editionFor={w.editionForStore}
                hot={hot}
                onHot={setHot}
                onOpen={open}
                loading={w.editionsLoading}
                empty={built === 0 && filter === "all" && !q ? undefined : "No store matches. Clear the search or pick another status."}
              />
            </div>
            {!w.editionsLoading && built === 0 ? (
              <p data-testid="empty-state" className="flex items-center gap-2 text-[14px] leading-5 text-ink-2">
                <Icon name="info" size={16} className="shrink-0 text-faint" />
                {isCurrent ? "No edition yet for this week. Build them with the button above." : `Nothing was built for the week of ${formatDate(w.week)}.`}
              </p>
            ) : null}
          </div>
        )}
      </Band>
    </Page>
  );
}

function PortfolioSkeleton() {
  return (
    <Page>
      <div role="status" aria-label="Loading the portfolio" className="flex flex-1 flex-col">
        <Band pad="frame" top={false}>
          <div className="ring-after relative rounded-xl bg-white px-5 pb-9 pt-7 md:px-8">
            <Skeleton className="h-8 w-56 rounded-full" />
            <Skeleton className="mt-6 h-9 w-72" />
            <Skeleton className="mt-4 h-3 w-96 max-w-full rounded-full" />
          </div>
        </Band>
        <Gap />
        <Band grow>
          <Skeleton className="mb-4 h-10 w-80 max-w-full rounded-full" />
          <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
            <CardBand title="Stores on the map" flush><Skeleton className="h-[320px] rounded-lg" /></CardBand>
            <CardBand title="This week's editions" flush><SkeletonRows rows={8} cols={4} /></CardBand>
          </div>
        </Band>
      </div>
    </Page>
  );
}
