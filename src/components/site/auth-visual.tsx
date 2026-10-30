"use client";

import { useEffect, useState } from "react";
import { BrandGlyph, Pill, StoreTile, cx } from "@/components/ui";
import type { LandingSample } from "@/server/landing/types";
import { MEASURED } from "./landing-data";
import { Icon } from "./section";

/** The demo workspace's view from the public read endpoint. `undefined` while loading, `null` when it could not be read (nothing invented). */
function useSample(): { sample: LandingSample | null | undefined; retry: () => void } {
  const [state, setState] = useState<LandingSample | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/landing/sample")
      .then((r) => (r.ok ? (r.json() as Promise<LandingSample>) : null))
      .then((d) => { if (live) setState(d); })
      .catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [tick]);
  return { sample: state, retry: () => { setState(undefined); setTick((n) => n + 1); } };
}

/** The product visual on the right: a dark band with this week's stores and one store's staff card. */
export function AuthVisual() {
  const { sample, retry } = useSample();
  const rows = sample?.rows.filter((r) => r.status !== "none").slice(0, 6) ?? [];
  const w = sample?.featured ?? null;
  return (
    <aside className="band-dither relative m-2 hidden flex-col overflow-hidden rounded-[22px] text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)] lg:flex">
      <div aria-hidden className="pointer-events-none absolute -right-40 top-24 size-[560px] rounded-full border border-white/[.05]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-40 size-[400px] rounded-full border border-white/[.05]" />
      <div className="relative px-12 pt-14 xl:px-16">
        <Pill dark icon={Icon.doc}>This week · Kettle &amp; Kiln (sample chain)</Pill>
        <p className="mt-6 max-w-[440px] text-[30px] font-medium leading-10 tracking-[-0.02em] text-band-ink">
          Every store gets its own front page, every Monday.
        </p>
      </div>
      <div className="relative flex flex-1 items-center px-12 py-12 xl:px-16">
        <div className="w-full max-w-[400px] rounded-xl bg-band-card shadow-[0_0_0_1px_rgb(255_255_255/.08)]">
          <p className="border-b border-white/[.06] px-4 py-3 text-[13px] font-medium text-band-ink-2">Editions this week</p>
          {sample === undefined ? <p className="px-4 py-3 text-[14px] text-band-ink-3">Loading this week&apos;s sample editions…</p> : null}
          {sample === null ? (
            <p className="flex items-center gap-3 px-4 py-3 text-[14px] text-band-ink-3">
              Loading this week&apos;s sample editions…
              <button type="button" onClick={retry} className="font-medium text-band-ink-2 underline underline-offset-[3px]">Retry</button>
            </p>
          ) : null}
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-white/[.04] px-4 py-2.5 text-[14px] last:border-0">
              <StoreTile colorIndex={r.colorIndex} name={r.name} />
              <span className="min-w-0 flex-1 truncate">{r.name}<span className="text-band-ink-3"> · {r.special}</span></span>
              <span className={cx("rounded-md px-2 py-0.5 text-[12px] font-medium", r.status === "flagged" ? "bg-[#3a1d1f] text-[#ff8a8f]" : "bg-white/[.06] text-band-ink-2")}>
                {r.status === "flagged" ? "Flagged" : "Draft"}
              </span>
            </div>
          ))}
        </div>
        {w ? <div className="absolute right-8 top-1/2 w-[248px] -translate-y-[38%] rotate-[1.5deg] rounded-[18px] bg-white p-1.5 text-ink shadow-ring-xl xl:right-16">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <StoreTile colorIndex={w.colorIndex} name={w.name} size="sm" />
            <span className="text-[12px] font-medium">{w.name} staff card</span>
          </div>
          {([["This week's special", w.special?.name], ["On the speakers", w.sound?.artists.slice(0, 2).join(", ")], ["Event", w.event ? `${w.event.title}, ${w.event.when}` : undefined]] as const).flatMap(([k, v]) => (v ? [(
            <div key={k} className="border-t border-rule-subtle px-2.5 py-2">
              <p className="text-[11px] font-medium text-muted">{k}</p>
              <p className="text-[13px] font-medium leading-5">{v}</p>
            </div>
          )] : []))}
        </div> : null}
      </div>
      <div className="relative flex items-center justify-between gap-6 border-t border-white/[.06] px-12 py-6 text-[13px] text-band-ink-3 xl:px-16">
        <span className="flex items-center gap-3 text-band-ink-2">
          {(["qloo", "nvidia", "nebius"] as const).map((b) => <BrandGlyph key={b} brand={b} className="size-4" />)}
          <span className="text-band-ink-3">Qloo · NVIDIA Nemotron · Nebius</span>
        </span>
        <span className="tnum">One store built in {MEASURED.buildSeconds} s for {MEASURED.buildCost}</span>
      </div>
    </aside>
  );
}

