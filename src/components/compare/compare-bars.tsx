"use client";

import { useState } from "react";
import type { BlockTag, Evidence, Store } from "@/contract";
import { CardBand, StoreTile, storeColor } from "../ui";
import { Icon } from "../app-ui/icons";
import { LogoTile, PROVIDER_NAME } from "../app-ui/tiles";
import { signed } from "../app-ui/status";
import { evidenceProvider } from "../edition/evidence-row";

/** Compare as designed bars: shared taste as paired bars, each store's own taste as a ranked list, then the evidence. */

const width = (v: number | undefined) => `${Math.max(2, Math.min(100, (v ?? 0) * 100))}%`;

function Bar({ store, value }: { store: Store; value: number | undefined }) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_40px] items-center gap-2.5">
      <StoreTile colorIndex={store.colorIndex} name={store.name} size="sm" />
      {value !== undefined ? (
        <span className="h-2 overflow-hidden rounded-full bg-stone-100" title={`${store.name}: affinity ${value.toFixed(2)}`}>
          <span className="block h-full rounded-full" style={{ width: width(value), background: storeColor(store.colorIndex) }} />
        </span>
      ) : (
        <span className="truncate text-[12px] text-muted">In its top tags too; no score in its profile</span>
      )}
      <span className="text-right font-mono text-[12px] text-ink-2">{value !== undefined ? value.toFixed(2) : "—"}</span>
    </div>
  );
}

/** Tags both blocks rank highly, with each block's affinity as a bar in its colour and the gap between them. */
export function SharedTaste({ a, b, tags, bTags, className }: { a: Store; b: Store; tags: BlockTag[]; bTags: BlockTag[] | undefined; className?: string }) {
  return (
    <CardBand
      title="Shared taste"
      icon={<Icon name="columns" />}
      className={className}
      flush
      actions={<span className="text-[13px] text-muted tnum">{tags.length} {tags.length === 1 ? "tag" : "tags"}</span>}
      footer={<span className="text-[13px] text-muted">Bars are Qloo affinity, 0 to 1. The gap is {a.name} minus {b.name}.</span>}
    >
      {tags.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-4 py-5 text-center text-[14px] leading-5 text-ink-2">
          <Icon name="info" size={16} className="shrink-0 text-faint" />
          These two blocks share none of their top tags, so their editions should look nothing alike.
        </p>
      ) : (
        <ul className="grid md:grid-cols-2 md:gap-x-6 md:px-4 [&>li]:border-b [&>li]:border-rule-row md:[&>li]:px-0">
          {tags.map((t) => {
            const other = bTags?.find((x) => x.tagId === t.tagId);
            const gap = other ? t.affinity - other.affinity : null;
            return (
              <li key={t.tagId} className="grid gap-2.5 px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[14px] font-medium text-ink-strong" title={t.name}>{t.name}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="text-[12px] capitalize text-muted">{t.kind}</span>
                    {gap !== null ? <span className={`font-mono text-[12px] ${Math.abs(gap) < 0.005 ? "text-empty" : gap > 0 ? "text-ok-ink" : "text-flag"}`}>Δ {signed(gap)}</span> : null}
                  </span>
                </div>
                <Bar store={a} value={t.affinity} />
                <Bar store={b} value={other?.affinity} />
              </li>
            );
          })}
        </ul>
      )}
    </CardBand>
  );
}

/** One block's distinctive tags, ranked, with bars in that store's colour and the lift over the city. */
export function OnlyHere({ store, tags, empty }: { store: Store; tags: BlockTag[]; empty: string }) {
  return (
    <CardBand
      title={<span className="inline-flex min-w-0 items-center gap-2"><StoreTile colorIndex={store.colorIndex} name={store.name} size="sm" /><span className="truncate">Only at {store.name}</span></span>}
      flush
      actions={<span className="text-[13px] text-muted">lift</span>}
    >
      {tags.length === 0 ? (
        <p className="px-4 py-8 text-center text-[14px] leading-5 text-ink-2">{empty}</p>
      ) : (
        <ol className="divide-y divide-rule-row px-4 py-1">
          {tags.map((t, i) => (
            <li key={t.tagId} className="grid grid-cols-[20px_minmax(0,1fr)_52px] items-center gap-x-2 py-2.5">
              <span className="text-[12px] font-medium text-ink-2 tnum">{i + 1}</span>
              <span className="min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[14px] font-medium text-ink-strong" title={t.name}>{t.name}</span>
                  <span className="shrink-0 font-mono text-[11.5px] text-muted">{t.affinity.toFixed(2)}</span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-stone-100">
                  <span className="block h-full rounded-full" style={{ width: width(t.affinity), background: storeColor(store.colorIndex) }} />
                </span>
              </span>
              <span className={`text-right font-mono text-[12.5px] ${t.lift >= 0 ? "text-ok-ink" : "text-flag"}`}>{signed(t.lift)}</span>
            </li>
          ))}
        </ol>
      )}
    </CardBand>
  );
}

/** The Qloo calls the comparison rests on. */
export function CompareEvidence({ evidence }: { evidence: Evidence[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? evidence : evidence.slice(0, 6);
  return (
    <CardBand title={`Evidence (${evidence.length})`} icon={<Icon name="file" />} flush
      actions={evidence.length > 6 ? (
        <button type="button" onClick={() => setAll((x) => !x)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover-tint hover:text-ink">
          {all ? "Show fewer" : `Show all ${evidence.length}`}
          <Icon name="chevronDown" size={14} className={all ? "rotate-180 text-faint" : "text-faint"} />
        </button>
      ) : null}
      footer={<span className="text-[13px] text-muted">Affinity is Qloo&apos;s score for each block; lift is that block&apos;s affinity minus the New York baseline.</span>}>
      {evidence.length === 0 ? (
        <p className="px-4 py-8 text-center text-[14px] text-muted">No calls recorded for this comparison.</p>
      ) : (
        <ul className="divide-y divide-rule-row">
          {shown.map((e) => {
            const p = evidenceProvider(e);
            return (
              <li key={e.id} className="grid gap-x-4 gap-y-1 px-4 py-3.5 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:items-center">
                <span className="flex min-w-0 items-center gap-2.5">
                  <LogoTile provider={p} size="md" title={PROVIDER_NAME[p]} />
                  <span className="truncate font-mono text-[13px] text-ink-2" title={e.endpoint}>{e.endpoint}</span>
                </span>
                <span className="text-[14px] leading-5 text-ink-2 [overflow-wrap:anywhere]">{e.summary}</span>
              </li>
            );
          })}
        </ul>
      )}
    </CardBand>
  );
}
