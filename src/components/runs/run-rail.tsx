"use client";

import { CardBand, cx } from "../ui";
import { Icon } from "../app-ui/icons";
import { LogoTile } from "../app-ui/tiles";
import { formatInt } from "../lib/format";
import type { ModelTotal } from "./run-model";
import { ModelChip, usd } from "./trace-entry";

/** Compact token count: 48,213 -> "48.2k". */
const k = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : formatInt(n));

/** The light right rail: every model that ran, its calls, tokens and share of the cost. */
export function ModelsAtWork({ models, total }: { models: ModelTotal[]; total: number }) {
  return (
    <CardBand
      title="Models at work"
      icon={<Icon name="cpu" />}
      flush
      footer={
        <span className="inline-flex items-center gap-2 text-[13px]">
          <LogoTile provider="tokenfactory" size="xs" />
          Every model runs on Nebius Token Factory, metered per call.
        </span>
      }
    >
      {models.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-5 text-[14px] text-muted"><Icon name="clock" size={14} />No model calls yet.</p>
      ) : (
        <ul className={cx("grid gap-px bg-rule-row sm:grid-cols-2", models.length >= 4 ? "xl:grid-cols-4" : models.length === 3 ? "xl:grid-cols-3" : "")}>
          {models.map((m, i) => {
            const share = total > 0 ? m.usd / total : 0;
            return (
              <li key={m.model} className={cx("grid content-start gap-2 bg-white px-4 py-3", i === models.length - 1 && models.length % 2 === 1 && "sm:col-span-2 xl:col-span-1")}>
                <div className="flex items-center justify-between gap-3">
                  <ModelChip model={m.model} dark={false} />
                  <span className="text-[14px] font-medium text-ink-strong tnum">{usd(m.usd)}</span>
                </div>
                <span className="h-1.5 overflow-hidden rounded-full bg-stone-100" aria-hidden>
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, share * 100)}%` }} />
                </span>
                <span className="font-mono text-[12px] text-muted tnum">
                  {m.calls} calls · {k(m.promptTokens)} in · {k(m.completionTokens)} out · {Math.round(share * 100)}% of cost
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </CardBand>
  );
}

/** One stat cell in the run header: icon + label, then the value at 24/32. */
export function RunStat({ label, value, icon, testId }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; testId?: string }) {
  return (
    <div data-testid={testId} className="min-w-0 py-3.5 lg:px-5 lg:first:pl-0">
      <dt className="flex items-center gap-1.5 text-[13px] leading-5 text-muted">
        <Icon name={icon} size={14} className="shrink-0 text-faint" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1 text-[24px] font-medium leading-8 tracking-[-0.025em] text-ink tnum">{value}</dd>
    </div>
  );
}
