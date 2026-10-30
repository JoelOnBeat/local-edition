"use client";

import type { ReactNode } from "react";
import { ButtonLink, CardBand, Chip, EmptyState } from "../ui";
import { Icon } from "../app-ui/icons";
import { formatInt } from "../lib/format";
import { ModelChip, usd } from "./trace-entry";
import { runWhen, useKnownRuns, type RunSummary } from "./run-summary";

export const RUN_STATE: Record<RunSummary["state"], { label: string; tone: "ok" | "info" | "warn" }> = {
  live: { label: "Running", tone: "info" },
  finished: { label: "Finished", tone: "ok" },
  stopped: { label: "Stream ended", tone: "warn" },
};

export function RunStateChip({ state }: { state: RunSummary["state"] }) {
  const s = RUN_STATE[state];
  return <Chip tone={s.tone} dot>{s.label}</Chip>;
}

/** Portfolio card: the newest run this browser started, with what it did and cost, linking to its trace. */
export function LastRunCard({ buildAction, className }: { buildAction?: ReactNode; className?: string }) {
  const runs = useKnownRuns();
  const r = runs[0];
  return (
    <CardBand
      title="Last agent run"
      icon={<Icon name="terminal" />}
      className={className}
      actions={r ? <RunStateChip state={r.state} /> : null}
      flush
      data-testid="last-run-card"
      footer={r && runs.length > 1 ? <ButtonLink href="/app/runs" variant="ghost" size="sm" className="-ml-2.5">All runs in this tab <span className="text-muted tnum">({runs.length})</span></ButtonLink> : undefined}
    >
      {!r ? (
        <EmptyState
          icon={<Icon name="terminal" size={20} />}
          title="No run in this browser yet"
          body="A build streams its trace to the tab that starts it: every Qloo call, model and cost, store by store."
          action={buildAction ?? <ButtonLink href="/app" variant="secondary" size="sm">Build this week&apos;s editions</ButtonLink>}
          className="py-10"
        />
      ) : (
        <div className="grid gap-4 p-4">
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-[14px] text-ink-2">
            <span className="font-medium text-ink">{runWhen(r.startedAt)}</span>
            <span className="truncate font-mono text-[12px] text-muted">{r.runId}</span>
          </p>
          <dl className="grid grid-cols-3 gap-3">
            {[["Stores", `${r.done}/${r.total}`], ["Tool calls", formatInt(r.toolCalls)], ["Model cost", usd(r.usd)]].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="truncate text-[13px] text-muted">{k}</dt>
                <dd className="text-[20px] font-medium leading-7 tracking-[-0.02em] text-ink tnum">{v}</dd>
              </div>
            ))}
          </dl>
          {r.models.length ? <div className="flex flex-wrap gap-1.5">{r.models.map((m) => <ModelChip key={m} model={m} dark={false} />)}</div> : null}
          <ButtonLink href={`/app/runs/${r.runId}`} variant="secondary" size="sm" className="justify-self-start" data-testid="last-run-open">
            {r.state === "live" ? "Watch the agent work" : "Open the trace"}
            <Icon name="arrowRight" size={14} />
          </ButtonLink>
        </div>
      )}
    </CardBand>
  );
}
