"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { Store } from "@/contract";
import { getApi } from "@/lib/api-client";
import { CardBand, EmptyState, ErrorState, Notice, Pill, StoreTile, cx } from "../ui";
import { Band, Gap, Page, PageHeader } from "../app-ui/frame";
import { Icon } from "../app-ui/icons";
import { Dropdown, MenuItem, MenuLabel } from "../app-ui/menu";
import { Skel } from "../app-ui/states";
import { useAsync } from "../lib/use-async";
import { useWorkspace } from "../app/workspace-context";
import { StoreChip } from "../edition/store-chip";
import { CompareEvidence, OnlyHere, SharedTaste } from "./compare-bars";

/** /app/compare: why one store's edition differs from another's, from the taste of each block. */
export function CompareView() {
  const w = useWorkspace();
  const api = getApi();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const stores = w.bundle?.stores ?? [];
  const a = stores.find((s) => s.id === params.get("a")) ?? stores[0];
  const b = stores.find((s) => s.id === params.get("b")) ?? stores.find((s) => s.colorIndex === 7 && s.id !== a?.id) ?? stores.find((s) => s.id !== a?.id);
  const same = !!a && !!b && a.id === b.id;
  const ready = a && b && !same;
  const cmp = useAsync(ready ? `cmp:${a.id}:${b.id}` : null, () => api.compareStores(a!.id, b!.id));
  const profB = useAsync(ready ? `prof:${b.id}` : null, () => api.getStoreProfile(b!.id));
  const pick = (key: "a" | "b", id: string) => {
    const q = new URLSearchParams(params.toString());
    q.set(key, id);
    if (a && !q.get("a")) q.set("a", a.id);
    if (b && !q.get("b")) q.set("b", b.id);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  if (w.error && !w.bundle) return <Page><Band top={false} grow><CardBand title="Compare" flush><ErrorState message={w.error.message} onRetry={w.reload} /></CardBand></Band></Page>;
  if (w.loading) return <CompareSkeleton />;
  if (stores.length < 2 || !a || !b) {
    return (
      <Page>
        <PageHeader pill={<Pill icon={<Icon name="columns" />}>Compare</Pill>} title="Compare two blocks" />
        <Gap />
        <Band grow>
          <CardBand title="Stores" flush className="flex-1" bodyClassName="flex flex-1 items-center justify-center">
            <EmptyState icon={<Icon name="columns" size={20} />} title="Compare needs two stores" body="Add another store in setup, then come back to see how their blocks differ." />
          </CardBand>
        </Band>
      </Page>
    );
  }

  const r = cmp.data?.result;
  return (
    <Page>
      <PageHeader
        pill={<Pill icon={<Icon name="columns" />}>Compare · Qloo taste</Pill>}
        title={<span className="inline-flex flex-wrap items-center gap-x-[.3em] gap-y-[.15em]"><StoreChip store={a} /> <span className="text-muted">vs</span> <StoreChip store={b} tilt={1} /></span>}
        lede={r && !cmp.error ? summary(a, b, r.shared.length, r.onlyA.length, r.onlyB.length) : "Two blocks, side by side: the taste they share and the taste only one of them has."}
      >
        <div className="mt-6 flex max-w-full flex-col gap-1 rounded-xl bg-paper-2 p-1 shadow-ring-xs sm:inline-flex sm:flex-row">
          <StorePicker testId="compare-a" label="Store A" value={a.id} stores={stores} onChange={(id) => pick("a", id)} />
          <StorePicker testId="compare-b" label="Store B" value={b.id} stores={stores} onChange={(id) => pick("b", id)} />
        </div>
      </PageHeader>
      <Gap />
      <Band grow>
        {same ? <Notice tone="warn" className="mb-3">Pick two different stores to compare.</Notice> : null}
        {cmp.error ? (
          <CardBand title="Shared taste" flush><ErrorState message={cmp.error.message} onRetry={cmp.reload} /></CardBand>
        ) : ready && !r ? (
          <BodySkeleton />
        ) : r ? (
          <div data-testid="compare-result" data-shared={r.shared.length} className="grid gap-3">
            <SharedTaste a={a} b={b} tags={r.shared} bTags={profB.data?.profile.tags} />
            <div className="grid gap-3 lg:grid-cols-2">
              <OnlyHere store={a} tags={r.onlyA} empty={`Nothing in ${a.name}'s top tags is unique to it.`} />
              <OnlyHere store={b} tags={r.onlyB} empty={`Nothing in ${b.name}'s top tags is unique to it.`} />
            </div>
            <CompareEvidence evidence={cmp.data?.evidence ?? []} />
          </div>
        ) : null}
      </Band>
    </Page>
  );
}

function summary(a: Store, b: Store, shared: number, onlyA: number, onlyB: number): ReactNode {
  if (shared === 0) return `${a.name} and ${b.name} share none of their top tags, so their specials, playlists and partners are built from different signals.`;
  return (
    <>
      {a.name} and {b.name} share <b className="font-medium text-ink tnum">{shared}</b> top tag{shared === 1 ? "" : "s"}. {a.name} has{" "}
      <b className="font-medium text-ink tnum">{onlyA}</b> the other block lacks and {b.name} has <b className="font-medium text-ink tnum">{onlyB}</b>; those
      differences are what the agent builds each edition from.
    </>
  );
}

function StorePicker({ testId, label, value, stores, onChange }: { testId: string; label: string; value: string; stores: Store[]; onChange: (id: string) => void }) {
  const current = stores.find((s) => s.id === value);
  return (
    <Dropdown
      label={label}
      width="w-64"
      className="w-full sm:w-auto"
      testId={testId}
      triggerClassName="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg bg-white pl-2 pr-3 text-left shadow-ring-xs transition-colors duration-150 hover:bg-stone-50 sm:w-[260px]"
      trigger={(open) => (
        <>
          {current ? <StoreTile colorIndex={current.colorIndex} name={current.name} size="md" /> : null}
          <span className="shrink-0 text-[13px] text-muted">{label}</span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-strong">{current?.name}</span>
          <Icon name="chevronsUpDown" size={14} className={cx("shrink-0 text-faint", open && "text-ink-2")} />
        </>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>{label}</MenuLabel>
          <div className="max-h-[min(360px,50dvh)] overflow-y-auto">
            {stores.map((s) => (
              <MenuItem key={s.id} testId={`${testId}-option-${s.id}`} active={s.id === value} className="py-1.5" onClick={() => { onChange(s.id); close(); }}>
                <StoreTile colorIndex={s.colorIndex} name={s.name} size="lg" />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {s.id === value ? <Icon name="check" size={14} className="text-ink-2" /> : null}
              </MenuItem>
            ))}
          </div>
        </>
      )}
    </Dropdown>
  );
}


function BodySkeleton() {
  return (
    <div className="grid gap-3" role="status" aria-label="Loading the comparison">
      <CardBand title="Shared taste" bodyClassName="grid gap-5 p-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="grid gap-2"><Skel className="h-2.5 w-40 rounded-full" /><Skel className="h-2 w-full rounded-full" /><Skel className="h-2 w-4/5 rounded-full" /></div>)}
      </CardBand>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => <CardBand key={i} title="Only here" bodyClassName="grid gap-4 p-4">{[0, 1, 2].map((j) => <Skel key={j} className="h-2.5 w-full rounded-full" />)}</CardBand>)}
      </div>
    </div>
  );
}

export function CompareSkeleton() {
  return (
    <Page>
      <Band pad="frame" top={false}>
        <div className="ring-after relative rounded-xl bg-white px-5 pb-9 pt-7 md:px-8">
          <Skel className="h-8 w-44 rounded-full" />
          <Skel className="mt-6 h-9 w-full max-w-lg" />
          <Skel className="mt-4 h-3 w-full max-w-md rounded-full" />
        </div>
      </Band>
      <Gap />
      <Band grow><BodySkeleton /></Band>
    </Page>
  );
}
