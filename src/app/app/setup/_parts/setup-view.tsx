"use client";

import { useState, type ReactNode } from "react";
import type { Chain, MenuItem, Store } from "@/contract";
import { useWorkspace } from "@/components/app/workspace-context";
import { ButtonLink, CardBand, ErrorState, Pill, SampleBadge, Skeleton } from "@/components/ui";
import { Band, FrameCard, Gap, Page, PageHeader } from "@/components/app-ui/frame";
import { Icon } from "@/components/app-ui/icons";
import { StepItem, StepStatusWord } from "@/components/app-ui/stepper-list";
import { AnchorsStep } from "./anchors-step";
import { MenuStep } from "./menu-step";
import { VoiceStep } from "./voice-step";

/** /app/setup: menu and stores, brand voice, taste anchors, as one stepper list. Each step saves on its own. */

function Step({ n, id, title, lede, done, last, children }: { n: number; id: string; title: string; lede: string; done: boolean; last?: boolean; children: ReactNode }) {
  return (
    <StepItem
      n={n}
      state={done ? "done" : "todo"}
      last={last}
      className={last ? undefined : "pb-10"}
      row={
        <div id={id} data-testid={`setup-step-${id}`} data-done={done} className="flex scroll-mt-28 items-start gap-3 pb-4 pt-[11px]">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-h`} className="text-[18px] font-medium leading-6 tracking-[-0.01em] text-ink">{title}</h2>
            <p className="mt-1 text-[14px] leading-5 text-ink-2">{lede}</p>
          </div>
          <StepStatusWord state={done ? "done" : "todo"} />
        </div>
      }
    >
      <section aria-labelledby={`${id}-h`} className="min-w-0">{children}</section>
    </StepItem>
  );
}

export function SetupView() {
  const { bundle, loading, error, reload } = useWorkspace();
  const [chain, setChain] = useState<Chain | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);

  const header = (lede: ReactNode, actions?: ReactNode, sample?: boolean) => (
    <PageHeader
      crumbs={[{ href: "/app/settings", label: "Settings" }, { label: "Chain setup" }]}
      pill={<Pill icon={<Icon name="list" />} badge={sample ? <SampleBadge /> : undefined}>Chain setup</Pill>}
      title="Set up your chain"
      lede={lede}
      actions={actions}
    />
  );

  if (loading) {
    return (
      <Page>
        {header("Loading your chain…")}
        <Gap />
        <Band grow><FrameCard className="grid gap-6 p-6 md:p-8">{[0, 1, 2].map((i) => <div key={i} className="flex gap-4"><Skeleton className="size-7 rounded-lg" /><div className="grid flex-1 gap-2.5"><Skeleton className="h-4 w-48 rounded-full" /><Skeleton className="h-3 w-72 max-w-full rounded-full" /><Skeleton className="h-24 w-full" /></div></div>)}</FrameCard></Band>
      </Page>
    );
  }
  if (error || !bundle) {
    return (
      <Page>
        {header("Three things and the Monday edition can be written.")}
        <Gap />
        <Band grow><CardBand title="Chain setup" flush><ErrorState message={error?.message ?? "The workspace did not load."} onRetry={reload} /></CardBand></Band>
      </Page>
    );
  }

  const c = chain ?? bundle.chain;
  const m = menu ?? bundle.menu;
  const s = stores ?? bundle.stores;
  const steps = [m.length > 0 && s.length > 0, c.brandVoice.length > 0, c.anchors.length > 0];
  const ready = steps.every(Boolean);
  const done = steps.filter(Boolean).length;

  return (
    <Page>
      {header(
        <>What you sell and where, how you talk, and which brands your crowd also loves. <span className="font-medium text-ink tnum">{done} of 3</span> done; everything stays editable.</>,
        <ButtonLink data-testid="setup-done" data-ready={ready} href="/app" variant={ready ? "primary" : "secondary"} size="sm" chevron={ready}>
          {ready ? "Build this week's editions" : "Back to the portfolio"}
        </ButtonLink>,
        c.isSample,
      )}
      <Gap />
      <Band grow>
        <FrameCard className="px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <ol className="mx-auto max-w-[920px]">
            <Step n={1} id="menu" title="Menu and stores" lede="From Square, so it stays current. A photo and a CSV work too." done={steps[0]}>
              <MenuStep menu={m} stores={s} onSaved={setMenu} onStores={setStores} reloadWorkspace={() => { setMenu(null); setStores(null); reload(); }} />
            </Step>
            <Step n={2} id="voice" title="Brand voice" lede="Every line of every edition is written in it, and checked against it." done={steps[1]}>
              <VoiceStep key={c.id} chain={c} onSaved={setChain} />
            </Step>
            <Step n={3} id="anchors" title="Taste anchors" lede="Brands your customers also love. Qloo reads each block through them." done={steps[2]} last>
              <AnchorsStep key={c.id} chain={c} onSaved={setChain} />
            </Step>
          </ol>
        </FrameCard>
      </Band>
    </Page>
  );
}
