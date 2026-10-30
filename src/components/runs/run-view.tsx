"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonLink, EmptyState, Notice, cx } from "../ui";
import { formatInt, formatUsd, modelName, pct } from "../lib/format";
import { useWorkspace } from "../app/workspace-context";
import { BuildButton } from "../portfolio/build-button";
import { deriveRun, menuSourceOf } from "./run-model";
import { useRun } from "./run-store";
import { StoreLane } from "./store-lane";

/** /app/runs/[runId]: the live agent trace, one lane per store, with the model and cost of every step. */
export function RunView({ runId }: { runId: string }) {
  const run = useRun(runId);
  const w = useWorkspace();
  const model = useMemo(() => deriveRun(run?.events ?? []), [run?.events]);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const refreshed = useRef(false);
  const reload = w.reload;

  useEffect(() => {
    if (model.finished && !refreshed.current) {
      refreshed.current = true;
      reload();
    }
  }, [model.finished, reload]);

  if (!run) {
    return (
      <EmptyState
        title="This run is not open in this tab"
        body="Live traces stream to the tab that started the build. The editions it produced are on the portfolio."
        action={<ButtonLink href="/app" variant="primary">Back to the portfolio</ButtonLink>}
      />
    );
  }

  const skipped = model.lanes.filter((l) => l.status === "skipped").map((l) => l.storeId);
  const ratio = model.total ? model.done / model.total : 0;
  const live = run.status === "streaming" || run.status === "reconnecting";
  const cacheShare = model.promptTokens ? model.cachedTokens / model.promptTokens : 0;
  const menuSource = menuSourceOf(w.bundle?.menu);
  const working = model.lanes.some((l) => (l.status === "working" || l.status === "retrying") && l.entries.length > 0);
  const lastDone = model.lanes.filter((l) => l.status === "done").at(-1)?.storeId;
  const isOpen = (id: string, status: string) => toggled[id] ?? (status === "working" || status === "retrying" || (!working && id === lastDone));

  return (
    <div className="space-y-6">
      <section className="border-b border-ink pb-5">
        <p data-testid="run-status" data-status={run.status} data-finished={model.finished} className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          <span className={cx("h-2 w-2 rounded-full", live ? "le-live-dot bg-accent" : model.finished ? "bg-ok" : "bg-warn")} aria-hidden />
          {run.status === "reconnecting" ? "Reconnecting, replaying from the run log" : live ? "Live agent trace" : model.finished ? "Run finished" : "Stream ended"}
          <span className="font-mono normal-case tracking-normal">· {runId}</span>
        </p>
        <h1 className="mt-1 font-display text-[32px] font-bold leading-[1.02] tracking-[-0.02em] sm:text-[44px]">
          {model.finished ? `${model.lanes.filter((l) => l.status === "done").length} editions drafted` : `Building ${model.total} edition${model.total === 1 ? "" : "s"}`}
        </h1>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-paper-2" data-testid="run-progress" role="progressbar" aria-valuenow={model.done} aria-valuemax={model.total}>
          <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          <Stat label="Stores done" value={`${model.done}/${model.total}`} />
          <Stat label="Tool calls" value={formatInt(model.toolCalls)} />
          <Stat label="Tokens" value={formatInt(model.promptTokens + model.completionTokens)} />
          <Stat label="Prompt cache" value={pct(cacheShare)} />
          <Stat label="Model cost" value={formatUsd(model.usd)} testId="run-cost" />
        </dl>
      </section>

      {run.status === "detached" ? (
        <Notice tone="warn">The stream closed before the run finished. This is everything that arrived; the server keeps building, and the portfolio shows the editions once they land.</Notice>
      ) : null}
      {model.runErrors.map((e, i) => <Notice key={i} tone="flag"><span className="font-mono text-[12px]">{e.code}</span> {e.message}</Notice>)}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-2.5">
          {model.lanes.map((l) => (
            <StoreLane key={l.storeId} lane={l} store={w.storeById(l.storeId)} open={isOpen(l.storeId, l.status)} menuSource={menuSource}
              onToggle={() => setToggled((t) => ({ ...t, [l.storeId]: !isOpen(l.storeId, l.status) }))} />
          ))}
        </div>
        <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
          <section>
            <p className="border-b border-ink pb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">Models at work</p>
            {model.models.length === 0 ? <p className="mt-2 text-[13px] text-muted">No model calls yet.</p> : null}
            <ul>
              {model.models.map((m) => (
                <li key={m.model} className="border-b border-rule py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-medium text-ink">{modelName(m.model)}</span>
                    <span className="font-mono text-[12.5px] text-ink">{formatUsd(m.usd)}</span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    {m.calls} calls · {formatInt(m.promptTokens)} in · {formatInt(m.completionTokens)} out
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-muted">Every model runs on Nebius Token Factory. Costs are metered per call.</p>
          </section>
          {skipped.length ? (
            <section className="space-y-3">
              <p className="border-b border-ink pb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">Skipped</p>
              <p className="text-[13px] text-ink-2">
                {skipped.map((id) => w.storeById(id)?.name ?? id).join(", ")} already {skipped.length === 1 ? "has" : "have"} approved items this week, so the build left {skipped.length === 1 ? "it" : "them"} alone.
              </p>
              {model.finished ? <BuildButton storeIds={skipped} force size="sm" label="Rebuild and replace approvals" /> : null}
            </section>
          ) : null}
          {model.finished ? <ButtonLink data-testid="run-back" href="/app" variant="primary" className="w-full">Review on the portfolio</ButtonLink> : null}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="font-mono text-[20px] font-medium leading-tight text-ink">{value}</dd>
    </div>
  );
}
