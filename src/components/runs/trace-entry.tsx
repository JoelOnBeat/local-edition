"use client";

import type { GuardrailStatus, MenuItem } from "@/contract";
import { Spinner, cx } from "../ui";
import { Icon, type IconName } from "../app-ui/icons";
import { BrandMark, LogoTile } from "../app-ui/tiles";
import { formatInt, formatMs, formatUsd, modelName } from "../lib/format";
import { KICKER, itemHeadline } from "../edition/item-content";
import { toolInfo, type TraceEntry } from "./run-model";

/** One line of a store's trace on the dark panel: a tool-call card, a model-call row, a drafted item, the review, an error. */

const GUARD_DARK: Record<GuardrailStatus, { label: string; cls: string; icon: IconName }> = {
  passed: { label: "Passed", cls: "text-band-own", icon: "shield" },
  rewritten: { label: "Rewritten", cls: "text-[#FCBB00]", icon: "pencil" },
  blocked: { label: "Blocked", cls: "text-[#FF6467]", icon: "x" },
  unchecked: { label: "Unchecked", cls: "text-[#FCBB00]", icon: "clock" },
};

/** A small chip on the dark panel (white 6% fill, 9% inset ring). */
export function DarkChip({ children, className, icon, iconClass }: { children: React.ReactNode; className?: string; icon?: IconName; iconClass?: string }) {
  return (
    <span className={cx("inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-md bg-white/[.06] px-2 text-[12px] font-medium leading-4 text-band-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.09)]", className)}>
      {icon ? <Icon name={icon} size={12} strokeWidth={2.4} className={cx("shrink-0", iconClass)} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The model as a chip: NVIDIA mark for Nemotron, Nebius mark for the other Token Factory models. */
export function ModelChip({ model, dark = true }: { model: string; dark?: boolean }) {
  const nemotron = /nemotron/i.test(model);
  return (
    <span
      title={model}
      className={cx(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-md px-1.5 pr-2 font-sans text-[12px] font-medium leading-4",
        dark ? "bg-white/[.06] text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.09)]" : "bg-white text-ink-strong shadow-ring-xs",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-white">
        <BrandMark brand={nemotron ? "nvidia" : "nebius"} size={nemotron ? 12 : 14} />
      </span>
      <span className="truncate">{modelName(model)}</span>
    </span>
  );
}

/** Cost of one call: sub-cent calls read "<$0.0001" rather than a row of zeros. */
export const usd = (v: number) => (v > 0 && v < 0.0001 ? "<$0.0001" : formatUsd(v));

const card = "rounded-xl bg-band-card shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]";

export function TraceLine({ e, menuSource }: { e: TraceEntry; menuSource?: MenuItem["source"] }) {
  if (e.kind === "tool") {
    const t = toolInfo(e.tool, menuSource);
    const args = Object.fromEntries(Object.entries(e.args).filter(([k]) => k !== "storeId"));
    return (
      <li data-testid="trace-tool" data-tool={e.tool} data-ok={e.result?.ok} className={cx("le-enter p-1.5", card)}>
        <div className="flex items-center gap-2.5 px-1 py-0.5">
          <span className="inline-flex h-[30px] min-w-0 max-w-full items-center gap-2 rounded-lg px-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.09)]">
            {t.provider ? <LogoTile provider={t.provider} size="xs" /> : <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-white/10 text-band-ink-2"><Icon name="file" size={11} /></span>}
            <span className="truncate font-mono text-[13px] text-band-ink">{t.label}</span>
          </span>
          <span className="flex-1" />
          {e.result ? (
            <span className={cx("inline-flex shrink-0 items-center gap-1 text-[12px] font-medium", e.result.ok ? "text-band-own" : "text-[#FF6467]")}>
              <Icon name={e.result.ok ? "check" : "x"} size={13} strokeWidth={2.4} />
              {e.result.ok ? "ok" : "failed"}
            </span>
          ) : (
            <Spinner className="size-3.5 shrink-0 text-band-ink-3" />
          )}
        </div>
        {Object.keys(args).length || e.result ? (
          <div className="mt-1.5 grid gap-px overflow-hidden rounded-lg bg-band-card-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)]">
            {Object.keys(args).length ? <p className="px-3 py-2 font-mono text-[12.5px] leading-5 [overflow-wrap:anywhere]"><JsonInline value={args} /></p> : null}
            {e.result ? (
              <p className="border-t border-white/[.06] px-3 py-2 font-mono text-[12.5px] leading-5 [overflow-wrap:anywhere] first:border-t-0">
                <span className="text-[#71717B]">{"// "}</span><span className="text-band-ink-2">{e.result.summary}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }
  if (e.kind === "model") {
    const s = e.step;
    const cached = s.promptTokens ? Math.round((s.cachedTokens / s.promptTokens) * 100) : 0;
    return (
      <li data-testid="trace-model" data-model={s.model} className="le-enter grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 px-2 py-1 font-mono text-[12px] leading-5 text-band-ink-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="min-w-0"><ModelChip model={s.model} /></span>
        <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap gap-x-2.5 sm:col-span-1 sm:row-start-auto">
          <span className="text-band-ink-2">{s.role}{s.tool ? ` · ${s.tool}` : ""}</span>
          <span className="tnum">{formatInt(s.promptTokens)}→{formatInt(s.completionTokens)} tok</span>
          {cached ? <span className="tnum">{cached}% cached</span> : null}
          <span className="tnum">{formatMs(s.ms)}</span>
        </span>
        <span className="col-start-2 row-start-1 text-right tnum text-band-ink-2 sm:col-start-3">{usd(s.usd)}</span>
      </li>
    );
  }
  if (e.kind === "item") {
    const g = e.guardrail ? GUARD_DARK[e.guardrail.status] : null;
    return (
      <li data-testid="trace-item" data-kind={e.item.kind} data-guardrail={e.guardrail?.status} className={cx("le-enter flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5", card)}>
        <Icon name="sparkles" size={14} className="shrink-0 text-accent-dark" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] leading-4 text-band-ink-3">Drafted · {KICKER[e.item.kind]}</span>
          <span className="block text-[14px] font-medium leading-5 text-band-ink [overflow-wrap:anywhere]">{itemHeadline(e.item)}</span>
        </span>
        {g ? <DarkChip icon={g.icon} iconClass={g.cls}>{g.label}</DarkChip> : <DarkChip><Spinner className="size-3" />Checking</DarkChip>}
      </li>
    );
  }
  if (e.kind === "review") {
    const ok = e.review.verdict === "approve";
    return (
      <li className={cx("le-enter flex gap-3 px-3 py-2.5", card)}>
        <Icon name="quote" size={14} className="mt-0.5 shrink-0 text-band-ink-3" />
        <p className="min-w-0 text-[13px] leading-5 text-band-ink-2 [overflow-wrap:anywhere]">
          <span className={cx("font-medium", ok ? "text-band-own" : "text-[#FCBB00]")}>{ok ? "Reviewer clears it." : "Reviewer wants a change."}</span> {e.review.reason}
        </p>
      </li>
    );
  }
  return (
    <li className="le-enter flex gap-3 rounded-xl bg-[#FB2C36]/[.08] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(251_44_54/.25)]">
      <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-[#FF6467]" />
      <p className="min-w-0 text-[13px] leading-5 text-band-ink-2 [overflow-wrap:anywhere]">
        <span className="font-mono text-[12px] text-[#FF6467]">{e.code}</span> {e.message}
      </p>
    </li>
  );
}

/** Tool arguments as one line of JSON in the shiki-dark palette (param pink, string mint, number/keyword blue, punctuation light). */
function JsonInline({ value }: { value: unknown }) {
  if (value === null || typeof value === "boolean") return <span className="text-[#77D4FF]">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-[#77D4FF]">{value}</span>;
  if (typeof value === "string") return <span className="text-[#5EE9B5]">&quot;{value}&quot;</span>;
  if (Array.isArray(value)) {
    return (
      <>
        <span className="text-[#E4E4E7]">[</span>
        {value.map((v, i) => <span key={i}>{i ? <span className="text-[#E4E4E7]">, </span> : null}<JsonInline value={v} /></span>)}
        <span className="text-[#E4E4E7]">]</span>
      </>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <>
      <span className="text-[#E4E4E7]">{"{ "}</span>
      {entries.map(([k, v], i) => (
        <span key={k}>
          {i ? <span className="text-[#E4E4E7]">, </span> : null}
          <span className="text-[#FDA5D5]">{k}</span><span className="text-[#E4E4E7]">: </span><JsonInline value={v} />
        </span>
      ))}
      <span className="text-[#E4E4E7]">{" }"}</span>
    </>
  );
}
