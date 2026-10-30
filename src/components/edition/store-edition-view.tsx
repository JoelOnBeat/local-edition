"use client";

import { useState, type ReactNode } from "react";
import type { EditionItem, Store } from "@/contract";
import { getApi } from "@/lib/api-client";
import { Button, ButtonLink, CardBand, EmptyState, ErrorState, Notice, Pill, StatusChip } from "../ui";
import { Band, Gap, Page, PageHeader } from "../app-ui/frame";
import { Icon } from "../app-ui/icons";
import { LogoTile } from "../app-ui/tiles";
import { isNvidia } from "./store-chip";
import { formatDate, formatDateTime, modelName } from "../lib/format";
import { useAsync } from "../lib/use-async";
import { useWorkspace } from "../app/workspace-context";
import { WeekPicker } from "../app/shell-controls";
import { BuildButton } from "../portfolio/build-button";
import { countApproved } from "../portfolio/status-meta";
import { BlockTaste } from "./block-taste";
import { DeliveryStrip } from "./delivery-strip";
import { EditionSkeleton } from "./edition-skeleton";
import { EvidenceDrawer } from "./evidence-drawer";
import { ItemBlock } from "./item-block";
import { EventContent, PartnerContent, SoundContent, SpecialContent } from "./item-content";
import { ReviewNote } from "./review-note";
import { StaffCardButton } from "./staff-card-button";
import { StoreChip } from "./store-chip";
import { StoreReplies } from "./store-replies";
import { WhyThisWeek } from "./why-this-week";
import { useDeliveries } from "./use-deliveries";
import { useItemActions } from "./use-item-actions";
import { useStoreReplies } from "./use-store-replies";

const crumbs = (store?: Store) => [{ href: "/app", label: "Portfolio" }, { label: store?.name ?? "Store" }];

/** /app/stores/[storeId]: the store's edition, four item cards beside the reviewer, the block's taste and where it went. */
export function StoreEditionView({ storeId }: { storeId: string }) {
  const w = useWorkspace();
  const api = getApi();
  const store = w.storeById(storeId);
  const edition = w.editionForStore(storeId);
  const profile = useAsync(store ? `profile:${storeId}` : null, () => api.getStoreProfile(storeId));
  const actions = useItemActions(edition);
  const deliveries = useDeliveries(edition?.id, edition?.items.map((i) => `${i.id}:${i.status}`).join(","));
  const replies = useStoreReplies(edition?.id);
  const [drawer, setDrawer] = useState<EditionItem | null>(null);

  if (w.error && !w.bundle) return <Page><Band top={false} grow><CardBand title="Edition" flush><ErrorState message={w.error.message} onRetry={w.reload} /></CardBand></Band></Page>;
  if (w.loading || !w.bundle || w.editionsLoading) return <EditionSkeleton />;
  if (!store) {
    return (
      <Page>
        <PageHeader crumbs={crumbs()} title="Store not found" />
        <Gap />
        <Band grow>
          <CardBand title="Store" flush className="flex-1" bodyClassName="flex flex-1 items-center justify-center">
            <EmptyState icon={<Icon name="store" size={20} />} title="That store is not in this chain" body="It may have been removed in setup. Pick a store from the portfolio."
              action={<ButtonLink href="/app" size="sm" variant="secondary" icon={<Icon name="arrowLeft" size={14} />}>Back to the portfolio</ButtonLink>} />
          </CardBand>
        </Band>
      </Page>
    );
  }
  const isCurrent = w.week === w.currentWeek;
  if (w.editionsError) {
    return <Page><PageHeader crumbs={crumbs(store)} title={<StoreChip store={store} />} /><Gap /><Band grow><CardBand title="Edition" flush><ErrorState message={w.editionsError.message} onRetry={w.reloadEditions} /></CardBand></Band></Page>;
  }
  if (!edition) {
    return (
      <Page>
        <PageHeader crumbs={crumbs(store)} pill={<Pill icon={<Icon name="calendar" />}>Week of {formatDate(w.week)}</Pill>} title={<StoreChip store={store} />} lede={store.addressLabel} actions={<WeekPicker />} />
        <Gap />
        <Band grow>
          <CardBand title="This week's edition" icon={<Icon name="file" />} flush className="flex-1" bodyClassName="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Icon name="file" size={20} />}
              title={isCurrent ? "No edition for this store yet" : "Nothing was built for this store that week"}
              body={isCurrent ? `Build ${store.name}'s edition now. The agent reads the block's taste from Qloo and drafts a special, a sound brief, a partner and an event night.` : "Pick another week in the top bar."}
              action={isCurrent ? <BuildButton storeIds={[store.id]} label={`Build ${store.name}'s edition`} size="sm" /> : undefined}
            />
          </CardBand>
        </Band>
      </Page>
    );
  }

  const byKind = <K extends EditionItem["kind"]>(k: K) => edition.items.find((i): i is Extract<EditionItem, { kind: K }> => i.kind === k);
  const special = byKind("special");
  const sound = byKind("sound");
  const partner = byKind("partner");
  const event = byKind("event");
  const readOnly = !isCurrent;
  const allApproved = edition.status === "approved";
  const block = (item: EditionItem | undefined, content: ReactNode) =>
    item ? <ItemBlock key={item.id} edition={edition} item={item} actions={actions} onEvidence={setDrawer} readOnly={readOnly}>{content}</ItemBlock> : null;

  return (
    <Page>
      <PageHeader
        crumbs={crumbs(store)}
        pill={
          <div className="flex flex-wrap items-center gap-2">
            <Pill icon={<Icon name="file" />}>Edition No. {edition.issueNo} · Week of {formatDate(edition.weekOf, { year: false })}</Pill>
            <span data-testid="edition-status" data-status={edition.status}><StatusChip status={edition.status} /></span>
          </div>
        }
        title={<StoreChip store={store} />}
        lede={
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="[overflow-wrap:anywhere]">{store.addressLabel}</span>
            <span className="text-faint" aria-hidden>·</span>
            <span>approved <b className="font-medium text-ink tnum">{countApproved(edition)} of {edition.items.length}</b></span>
            <span className="text-faint" aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">built by {isNvidia(edition.generatedBy.agentModel) ? <LogoTile provider="nemotron" size="xs" /> : null}<span className="font-medium text-ink">{modelName(edition.generatedBy.agentModel)}</span></span>
          </p>
        }
        actions={
          readOnly ? (
            <>
              <WeekPicker />
              <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-stone-100 px-3 text-[14px] text-ink-2"><Icon name="clock" size={14} />Read only</span>
            </>
          ) : (
            <>
              <WeekPicker />
              {allApproved ? <StaffCardButton editionId={edition.id} /> : null}
              {!allApproved ? (
                <Button data-testid="approve-all" variant="primary" size="sm" loading={actions.busy === "approve-all"} disabled={actions.busy !== null} onClick={actions.approveAll} icon={<Icon name="check" size={14} strokeWidth={2.4} />}>
                  Approve all
                </Button>
              ) : null}
            </>
          )
        }
      />
      <Gap />
      <Band grow>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid min-w-0 content-start gap-3">
            {actions.notice ? <Notice tone="ok" data-testid="approve-all-notice">{actions.notice}</Notice> : null}
            {actions.problem && actions.problem.itemId === null ? (
              <Notice tone={actions.problem.tone} data-testid="edition-problem"
                action={actions.problem.fix === "reload" ? <Button size="sm" onClick={() => actions.fix(actions.problem!)}>Reload</Button> : undefined}>
                {actions.problem.message}
              </Notice>
            ) : null}
            {edition.sourceChange ? (
              <Notice tone="warn">
                <span className="inline-flex items-center gap-2"><LogoTile provider="square" size="xs" /><b className="font-medium text-ink">{edition.sourceChange.summary}</b></span>
                <span className="ml-1 font-mono text-[12px] text-muted">{formatDateTime(edition.sourceChange.at)}</span>
              </Notice>
            ) : null}
            {block(special, special ? <SpecialContent item={special} base={w.bundle.menu.find((m) => m.id === special.baseMenuItemId)} profile={profile.data?.profile.tags} /> : null)}
            {block(sound, sound ? <SoundContent item={sound} /> : null)}
            {block(partner, partner ? <PartnerContent item={partner} /> : null)}
            {block(event, event ? <EventContent item={event} /> : null)}
          </div>
          <aside className="grid min-w-0 content-start gap-3 lg:sticky lg:top-20 lg:self-start">
            <ReviewNote review={edition.review} storeById={w.storeById} />
            <BlockTaste profile={profile.data?.profile} loading={profile.loading} />
            <WhyThisWeek edition={edition} onEvidence={setDrawer} />
            <DeliveryStrip deliveries={deliveries} />
            <StoreReplies edition={edition} replies={replies} actions={actions} readOnly={readOnly} />
          </aside>
        </div>
      </Band>
      <EvidenceDrawer edition={edition} item={drawer} profile={profile.data?.profile} onClose={() => setDrawer(null)} />
    </Page>
  );
}

