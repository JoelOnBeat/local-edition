"use client";

import type { Edition, EditionItem } from "@/contract";
import { CardBand, headlineMetric } from "../ui";
import { Icon } from "../app-ui/icons";
import { LogoTile } from "../app-ui/tiles";
import { evidenceProvider } from "./evidence-row";
import { KICKER, itemHeadline } from "./item-content";

/** Annotation-style list: one numbered note per item saying what it rests on; each opens that item's evidence. */
export function WhyThisWeek({ edition, onEvidence }: { edition: Edition; onEvidence: (item: EditionItem) => void }) {
  return (
    <CardBand title="Why this week" icon={<Icon name="list" />} flush>
      <ol className="relative px-4 py-2">
        <span className="absolute bottom-6 left-[25.5px] top-6 w-px bg-rule" aria-hidden />
        {edition.items.map((item, i) => {
          const ev = item.evidenceIds.map((id) => edition.evidence.find((e) => e.id === id)).filter((e) => e !== undefined);
          const first = ev[0];
          const metric = first ? headlineMetric(first) : null;
          return (
            <li key={item.id} className="relative">
              <button type="button" onClick={() => onEvidence(item)} className="group flex w-full items-start gap-3 rounded-lg py-2.5 pr-1 text-left">
                <span className="relative z-[1] mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-ink-2 ring-1 ring-rule tnum">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-muted">{KICKER[item.kind]}</span>
                  <span className="block truncate text-[14px] font-medium text-ink-strong group-hover:underline group-hover:decoration-stone-300 group-hover:underline-offset-[3px]">{itemHeadline(item)}</span>
                  {first ? (
                    <span className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-rule bg-white py-0.5 pl-1 pr-2 text-[12px]">
                      <LogoTile provider={evidenceProvider(first)} size="xs" />
                      <span className="truncate font-mono text-ink-2">{first.endpoint}</span>
                      {metric ? <span className="shrink-0 font-medium text-ink-strong tnum">{metric}</span> : null}
                      {ev.length > 1 ? <span className="shrink-0 text-muted tnum">+{ev.length - 1}</span> : null}
                    </span>
                  ) : null}
                </span>
                <Icon name="arrowUpRight" size={14} className="mt-1 shrink-0 text-faint transition-[translate,color] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink-2" />
              </button>
            </li>
          );
        })}
      </ol>
    </CardBand>
  );
}
