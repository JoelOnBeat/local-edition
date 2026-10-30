"use client";

import Link from "next/link";
import type { MenuItem, Store } from "@/contract";
import { Chip, GuardrailChip, ProviderBadge, Spinner, StoreSwatch, cx } from "../ui";
import { formatInt, formatMs, formatUsd, modelName } from "../lib/format";
import { KICKER, itemHeadline } from "../edition/item-content";
import { formatArgs, toolInfo, type Lane, type TraceEntry } from "./run-model";

const STATUS: Record<Lane["status"], { label: string; tone: "neutral" | "info" | "ok" | "warn" | "flag" }> = {
  queued: { label: "Queued", tone: "neutral" },
  working: { label: "Working", tone: "info" },
  retrying: { label: "Retrying", tone: "warn" },
  done: { label: "Drafted", tone: "ok" },
  skipped: { label: "Skipped", tone: "warn" },
  error: { label: "Failed", tone: "flag" },
};

/** One store's slice of the run: its tool calls, model calls and drafted items as they stream in. */
export function StoreLane({ lane, store, open, onToggle, menuSource }: { lane: Lane; store?: Store; open: boolean; onToggle: () => void; menuSource?: MenuItem["source"] }) {
  const s = STATUS[lane.status];
  return (
    <section data-testid={`lane-${lane.storeId}`} data-status={lane.status} className={cx("rounded-[var(--radius)] border bg-paper", lane.status === "working" || lane.status === "retrying" ? "border-ink-2" : "border-rule")}>
      <button type="button" data-testid={`lane-toggle-${lane.storeId}`} onClick={onToggle} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left">
        <span className="flex min-w-0 flex-1 text-[15px] font-semibold text-ink">
          <StoreSwatch colorIndex={store?.colorIndex ?? 1} name={store?.name ?? lane.storeId} size="lg" />
        </span>
        <span className="order-last w-full font-mono text-[12px] text-muted sm:order-none sm:w-auto">
          {lane.toolCalls} calls · {formatInt(lane.tokens)} tok · {formatUsd(lane.usd)}
        </span>
        <Chip tone={s.tone} dot>
          {lane.status === "working" || lane.status === "retrying" ? <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />{s.label}</span> : s.label}
        </Chip>
      </button>
      {open ? (
        <div className="border-t border-rule px-4 pb-3 pt-2">
          {lane.entries.length === 0 ? (
            <p className="py-2 text-[13px] text-muted">{lane.status === "working" ? "The agent is planning this store's calls." : "Waiting for the agent to reach this store."}</p>
          ) : null}
          <ol className="space-y-0.5">
            {lane.entries.map((e) => <Entry key={e.key} e={e} menuSource={menuSource} />)}
          </ol>
          {lane.editionId ? (
            <Link href={`/app/stores/${lane.storeId}`} className="mt-3 inline-block text-[13px] font-medium text-ink underline decoration-rule underline-offset-4 hover:decoration-ink">
              Open {store?.name ?? "the"} edition →
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Entry({ e, menuSource }: { e: TraceEntry; menuSource?: MenuItem["source"] }) {
  if (e.kind === "tool") {
    const t = toolInfo(e.tool, menuSource);
    const args = formatArgs(e.args);
    return (
      <li data-testid="trace-tool" data-tool={e.tool} data-ok={e.result?.ok} className="le-enter grid grid-cols-[18px_1fr] gap-x-2 py-1.5">
        <span className="pt-0.5 font-mono text-[12px] text-muted">→</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {t.provider ? <ProviderBadge provider={t.provider} compact /> : null}
            <span className="font-mono text-[12.5px] font-medium text-ink [overflow-wrap:anywhere]">{t.label}</span>
            {args ? <span className="font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">({args})</span> : null}
            {e.result ? (
              <span className={cx("font-mono text-[12px]", e.result.ok ? "text-ok" : "text-flag")}>{e.result.ok ? "✓" : "✕"}</span>
            ) : (
              <Spinner className="h-3 w-3 text-muted" />
            )}
          </div>
          {e.result ? <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{e.result.summary}</p> : null}
        </div>
      </li>
    );
  }
  if (e.kind === "model") {
    const s = e.step;
    const cached = s.promptTokens ? Math.round((s.cachedTokens / s.promptTokens) * 100) : 0;
    return (
      <li data-testid="trace-model" data-model={s.model} className="le-enter grid grid-cols-[18px_1fr] gap-x-2 py-0.5">
        <span className="font-mono text-[12px] text-muted">⋯</span>
        <p className="font-mono text-[11.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
          <span className="text-ink-2">{modelName(s.model)}</span> · {s.role}{s.tool ? ` · ${s.tool}` : ""} · {formatInt(s.promptTokens)}→{formatInt(s.completionTokens)} tok
          {cached ? ` (${cached}% cached)` : ""} · {formatMs(s.ms)} · <span className="text-ink-2">{formatUsd(s.usd)}</span>
        </p>
      </li>
    );
  }
  if (e.kind === "item") {
    return (
      <li data-testid="trace-item" data-kind={e.item.kind} data-guardrail={e.guardrail?.status} className="le-enter grid grid-cols-[18px_1fr] gap-x-2 py-1.5">
        <span className="font-mono text-[12px] text-ink">✎</span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{KICKER[e.item.kind]}</span>
          <span className="text-[13.5px] font-medium text-ink [overflow-wrap:anywhere]">{itemHeadline(e.item)}</span>
          {e.guardrail ? <GuardrailChip status={e.guardrail.status} short /> : <Chip>Checking…</Chip>}
        </div>
      </li>
    );
  }
  if (e.kind === "review") {
    return (
      <li className="le-enter grid grid-cols-[18px_1fr] gap-x-2 py-1.5">
        <span className="font-mono text-[12px] text-muted">§</span>
        <p className="text-[13px] text-ink-2"><b className="font-medium text-ink">{e.review.verdict === "approve" ? "Reviewer clears it." : "Reviewer wants a change."}</b> {e.review.reason}</p>
      </li>
    );
  }
  return (
    <li className="grid grid-cols-[18px_1fr] gap-x-2 py-1.5">
      <span className="font-mono text-[12px] text-flag">!</span>
      <p className="text-[13px] text-ink-2"><span className="font-mono text-[11.5px] text-flag">{e.code}</span> {e.message}</p>
    </li>
  );
}
