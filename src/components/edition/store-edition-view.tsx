"use client";

import Link from "next/link";
import { useState } from "react";
import type { Delivery, EditionItem } from "@/contract";
import { getApi } from "@/lib/api-client";
import { Button, Dot, EmptyState, ErrorState, Masthead, Notice, Skeleton, SkeletonText, StatusChip } from "../ui";
import { formatDate, modelName } from "../lib/format";
import { useAsync } from "../lib/use-async";
import { useWorkspace } from "../app/workspace-context";
import { BuildButton } from "../portfolio/build-button";
import { BlockTaste } from "./block-taste";
import { DeliveryStrip } from "./delivery-strip";
import { EvidenceDrawer } from "./evidence-drawer";
import { ItemBlock } from "./item-block";
import { EventContent, PartnerContent, SoundContent, SpecialContent } from "./item-content";
import { ReviewNote } from "./review-note";
import { StaffCardButton } from "./staff-card-button";
import { useItemActions } from "./use-item-actions";

/** Deliveries come from the connector routes once they exist; until then the strip renders nothing. */
const NO_DELIVERIES: Delivery[] = [];

/** /app/stores/[storeId]: the store's edition as a small front page. */
export function StoreEditionView({ storeId }: { storeId: string }) {
  const w = useWorkspace();
  const api = getApi();
  const store = w.storeById(storeId);
  const edition = w.editionForStore(storeId);
  const profile = useAsync(store ? `profile:${storeId}` : null, () => api.getStoreProfile(storeId));
  const actions = useItemActions(edition);
  const [drawer, setDrawer] = useState<EditionItem | null>(null);

  if (w.error && !w.bundle) return <ErrorState message={w.error.message} onRetry={w.reload} />;
  if (w.loading || !w.bundle) return <EditionSkeleton />;
  if (!store) {
    return (
      <EmptyState title="That store is not in this chain" body="It may have been removed in Setup. Pick a store from the portfolio."
        action={<Link href="/app" className="text-sm font-medium underline underline-offset-4">Back to the portfolio</Link>} />
    );
  }
  const isCurrent = w.week === w.currentWeek;
  const title = `The ${store.name} Edition`;
  if (w.editionsLoading) return <EditionSkeleton />;
  if (w.editionsError) return <ErrorState message={w.editionsError.message} onRetry={w.reloadEditions} />;
  if (!edition) {
    return (
      <div className="space-y-6">
        <Masthead title={title} colorIndex={store.colorIndex} kicker={`${w.bundle.chain.name} · Local Edition`}
          dateline={<><span>Week of {formatDate(w.week)}</span><Dot /><span>{store.addressLabel}</span></>} />
        <EmptyState
          title={isCurrent ? "No edition for this store yet" : "Nothing was built for this store that week"}
          body={isCurrent ? `Build ${store.name}'s edition now. The agent reads the block's taste from Qloo and drafts a special, a sound brief, a partner and an event night.` : "Pick another week in the top bar."}
          action={isCurrent ? <BuildButton storeIds={[store.id]} label={`Build ${store.name}'s edition`} /> : undefined}
        />
      </div>
    );
  }

  const byKind = <K extends EditionItem["kind"]>(k: K) => edition.items.find((i): i is Extract<EditionItem, { kind: K }> => i.kind === k);
  const special = byKind("special");
  const sound = byKind("sound");
  const partner = byKind("partner");
  const event = byKind("event");
  const readOnly = !isCurrent;
  const allApproved = edition.status === "approved";
  const block = (item: EditionItem | undefined, content: React.ReactNode, lead = false) =>
    item ? (
      <ItemBlock edition={edition} item={item} actions={actions} onEvidence={setDrawer} lead={lead} readOnly={readOnly}>{content}</ItemBlock>
    ) : null;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/app" className="text-[13px] text-muted hover:text-ink">← Portfolio</Link>
        <Masthead
          className="mt-2"
          title={title}
          kicker={`${w.bundle.chain.name} · Local Edition`}
          issueNo={edition.issueNo}
          colorIndex={store.colorIndex}
          dateline={
            <>
              <StatusChip status={edition.status} />
              <span>Week of {formatDate(edition.weekOf)}</span><Dot />
              <span className="min-w-0 [overflow-wrap:anywhere]">{store.addressLabel}</span><Dot />
              <span className="text-muted">Built by {modelName(edition.generatedBy.agentModel)}</span>
            </>
          }
          actions={
            readOnly ? null : (
              <>
                {allApproved ? <StaffCardButton editionId={edition.id} /> : null}
                {!allApproved ? (
                  <Button variant="primary" size="sm" loading={actions.busy === "approve-all"} disabled={actions.busy !== null} onClick={actions.approveAll}>
                    Approve all
                  </Button>
                ) : null}
              </>
            )
          }
        />
        {actions.notice ? <Notice tone="ok" className="mt-3">{actions.notice}</Notice> : null}
        {actions.problem && actions.problem.itemId === null ? (
          <Notice tone={actions.problem.tone} className="mt-3"
            action={actions.problem.fix === "reload" ? <Button size="sm" onClick={() => actions.fix(actions.problem!)}>Reload</Button> : undefined}>
            {actions.problem.message}
          </Notice>
        ) : null}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-10">
        {block(special, special ? <SpecialContent item={special} base={w.bundle.menu.find((m) => m.id === special.baseMenuItemId)} /> : null, true)}
        <div className="space-y-6">
          <ReviewNote review={edition.review} storeById={w.storeById} />
          <BlockTaste profile={profile.data?.profile} loading={profile.loading} colorIndex={store.colorIndex} />
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 lg:gap-10">
        {block(sound, sound ? <SoundContent item={sound} /> : null)}
        {block(partner, partner ? <PartnerContent item={partner} /> : null)}
        {block(event, event ? <EventContent item={event} /> : null)}
      </div>

      <DeliveryStrip deliveries={NO_DELIVERIES} />
      {w.bundle.chain.isSample ? (
        <p className="border-t border-rule pt-3 text-[12px] text-muted">
          Sample chain: the stores, partner places and event listings are invented for the demo. Nothing here is a real customer.
        </p>
      ) : null}

      <EvidenceDrawer edition={edition} item={drawer} profile={profile.data?.profile} onClose={() => setDrawer(null)} />
    </div>
  );
}

function EditionSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading the edition">
      <div className="space-y-3">
        <Skeleton className="h-1.5 w-full" />
        <Skeleton className="h-14 w-full max-w-2xl" />
        <Skeleton className="h-5 w-full" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4"><Skeleton className="h-10 w-3/4" /><SkeletonText lines={4} /></div>
        <SkeletonText lines={6} />
      </div>
      <div className="grid gap-8 md:grid-cols-3">
        {[0, 1, 2].map((i) => <SkeletonText key={i} lines={6} />)}
      </div>
    </div>
  );
}
