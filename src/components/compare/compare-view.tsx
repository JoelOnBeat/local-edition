"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Store } from "@/contract";
import { getApi } from "@/lib/api-client";
import { EmptyState, ErrorState, EvidenceChip, Notice, Skeleton, SkeletonText, storeColor } from "../ui";
import { useAsync } from "../lib/use-async";
import { useWorkspace } from "../app/workspace-context";
import { SharedColumn, TagColumn } from "./tag-column";

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

  if (w.error && !w.bundle) return <ErrorState message={w.error.message} onRetry={w.reload} />;
  if (w.loading) return <SkeletonText lines={8} />;
  if (stores.length < 2 || !a || !b) {
    return <EmptyState title="Compare needs two stores" body="Add another store in Setup, then come back to see how their blocks differ." />;
  }

  return (
    <div className="space-y-6">
      <section className="border-b border-ink pb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Compare two blocks · Qloo taste</p>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-x-3 font-display text-[30px] font-bold leading-[1.05] tracking-[-0.02em] sm:text-[44px]">
          <span style={{ color: storeColor(a.colorIndex) }}>{a.name}</span>
          <span className="text-muted" aria-label="versus">↔</span>
          <span style={{ color: storeColor(b.colorIndex) }}>{b.name}</span>
        </h1>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <StorePicker label="Store A" value={a.id} stores={stores} onChange={(id) => pick("a", id)} />
          <StorePicker label="Store B" value={b.id} stores={stores} onChange={(id) => pick("b", id)} />
        </div>
      </section>

      {same ? <Notice tone="warn">Pick two different stores to compare.</Notice> : null}
      {cmp.error ? <ErrorState message={cmp.error.message} onRetry={cmp.reload} /> : null}
      {ready && cmp.loading && !cmp.data ? (
        <div className="grid gap-8 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="space-y-3"><Skeleton className="h-6 w-1/2" /><SkeletonText lines={6} /></div>)}</div>
      ) : null}

      {ready && cmp.data && !cmp.error ? (
        <>
          <p className="max-w-[70ch] text-[15px] leading-relaxed text-ink-2">
            {summary(a, b, cmp.data.result.shared.length, cmp.data.result.onlyA.length, cmp.data.result.onlyB.length)}
          </p>
          <div className="grid gap-8 md:grid-cols-3 lg:gap-10">
            <TagColumn title="Only here" store={a} tags={cmp.data.result.onlyA} empty={`Nothing in ${a.name}'s top tags is unique to it.`} />
            <SharedColumn a={a} b={b} tags={cmp.data.result.shared} bTags={profB.data?.profile.tags} />
            <TagColumn title="Only here" store={b} tags={cmp.data.result.onlyB} empty={`Nothing in ${b.name}'s top tags is unique to it.`} />
          </div>
          <section className="border-t border-rule pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Evidence</p>
            <ul className="mt-2 space-y-2">
              {cmp.data.evidence.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <EvidenceChip evidence={e} />
                  <span className="text-[13px] text-ink-2">{e.summary}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-muted">Scores are Qloo affinity (0 to 1) for each block; lift is that block&apos;s affinity minus the New York baseline.</p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function summary(a: Store, b: Store, shared: number, onlyA: number, onlyB: number): string {
  if (shared === 0) return `${a.name} and ${b.name} share none of their top tags, so their specials, playlists and partners are built from different signals.`;
  return `${a.name} and ${b.name} share ${shared} top tag${shared === 1 ? "" : "s"}. ${a.name} has ${onlyA} the other block lacks and ${b.name} has ${onlyB}; those differences are what the agent builds each edition from.`;
}

function StorePicker({ label, value, stores, onChange }: { label: string; value: string; stores: Store[]; onChange: (id: string) => void }) {
  const current = stores.find((s) => s.id === value);
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius)] border border-rule bg-paper px-3 sm:max-w-xs">
      <span className="h-3 w-3 shrink-0 rounded-[2px]" style={{ background: storeColor(current?.colorIndex ?? 1) }} aria-hidden />
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 min-w-0 flex-1 bg-transparent text-[14px] font-medium text-ink focus:outline-none">
        {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
  );
}
