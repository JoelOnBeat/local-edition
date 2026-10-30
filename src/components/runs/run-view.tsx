"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonLink, CardBand, EmptyState, Notice, Pill, cx } from "../ui";
import { Band, Gap, Page, PageHeader } from "../app-ui/frame";
import { Icon } from "../app-ui/icons";
import { formatInt, formatUsd, pct } from "../lib/format";
import { useWorkspace } from "../app/workspace-context";
import { BuildButton } from "../portfolio/build-button";
import { deriveRun, menuSourceOf } from "./run-model";
import { useRun } from "./run-store";
import { ModelsAtWork, RunStat } from "./run-rail";
import { StoreSwitcher } from "./store-lane";
import { TracePanel } from "./trace-panel";
import { runWhen } from "./run-summary";

const CRUMBS = (runId: string) => [{ href: "/app", label: "Portfolio" }, { label: "Agent run" }, { label: <span className="font-mono text-[12px]">{runId}</span> }];

/** /app/runs/[runId]: the live agent trace, one lane per store on the dark panel, with the model and cost of every step. */
export function RunView({ runId }: { runId: string }) {
  const run = useRun(runId);
  const w = useWorkspace();
  const model = useMemo(() => deriveRun(run?.events ?? []), [run?.events]);
  const [picked, setPicked] = useState<string | null>(null);
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
      <Page>
        <PageHeader crumbs={CRUMBS(runId)} pill={<Pill icon={<Icon name="terminal" />}>Agent run</Pill>} title="This run is not open in this tab" />
        <Gap />
        <Band grow>
          <CardBand title="Agent trace" icon={<Icon name="terminal" />} flush className="flex-1" bodyClassName="flex flex-1 items-center justify-center min-h-[360px]">
            <EmptyState
              icon={<Icon name="terminal" size={20} />}
              title="Live traces stream to the tab that started the build"
              body="The editions it produced are on the portfolio, each with the evidence and the model behind every line."
              action={<ButtonLink href="/app" variant="primary" size="sm" chevron>Back to the portfolio</ButtonLink>}
            />
          </CardBand>
        </Band>
      </Page>
    );
  }

  const skipped = model.lanes.filter((l) => l.status === "skipped").map((l) => l.storeId);
  const ratio = model.total ? model.done / model.total : 0;
  const live = run.status === "streaming" || run.status === "reconnecting";
  const cacheShare = model.promptTokens ? model.cachedTokens / model.promptTokens : 0;
  const menuSource = menuSourceOf(w.bundle?.menu);
  const working = model.lanes.find((l) => (l.status === "working" || l.status === "retrying") && l.entries.length > 0);
  const lastDone = model.lanes.filter((l) => l.status === "done").at(-1);
  const shownId = picked ?? working?.storeId ?? lastDone?.storeId ?? model.lanes[0]?.storeId ?? null;
  const shown = model.lanes.find((l) => l.storeId === shownId);
  const drafted = model.lanes.filter((l) => l.status === "done").length;
  const when = run.startedAt ? ` · ${runWhen(run.startedAt)}` : "";
  const statusLabel = (run.status === "reconnecting" ? "Reconnecting, replaying the run log" : live ? "Live agent trace" : model.finished ? "Run finished" : "Stream ended") + when;

  return (
    <Page>
      <PageHeader
        crumbs={CRUMBS(runId)}
        pill={
          <span data-testid="run-status" data-status={run.status} data-finished={model.finished}>
            <Pill icon={live ? <span className="le-live-dot size-1.5 rounded-full bg-accent" /> : <Icon name={model.finished ? "check" : "alert"} />}>{statusLabel}</Pill>
          </span>
        }
        title={model.finished ? `${drafted} edition${drafted === 1 ? "" : "s"} drafted` : `Building ${model.total} edition${model.total === 1 ? "" : "s"}`}
        lede={
          <p className="flex flex-wrap gap-x-1.5 tnum">
            <span><b className="font-medium text-ink">{model.done} of {model.total}</b> stores</span><span className="text-faint">·</span>
            <span><b className="font-medium text-ink">{formatUsd(model.usd)}</b> spent</span><span className="text-faint">·</span>
            <span><b className="font-medium text-ink">{formatInt(model.toolCalls)}</b> tool calls</span>
          </p>
        }
        actions={model.finished ? <ButtonLink data-testid="run-back" href="/app" variant="primary" size="lg" chevron>Review on the portfolio</ButtonLink> : null}
      >
        <div className="mt-7 md:mt-8">
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-stone-100" data-testid="run-progress" role="progressbar" aria-label="Stores done" aria-valuenow={model.done} aria-valuemin={0} aria-valuemax={model.total}>
            <div className="le-progress-fill h-full rounded-full bg-accent" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
          </div>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-rule-subtle">
            <RunStat icon="store" label="Stores done" value={`${model.done}/${model.total}`} />
            <RunStat icon="bolt" label="Tool calls" value={formatInt(model.toolCalls)} />
            <RunStat icon="layers" label="Tokens" value={formatInt(model.promptTokens + model.completionTokens)} />
            <RunStat icon="refresh" label="Prompt cache" value={pct(cacheShare)} />
            <RunStat icon="coins" label="Model cost" value={formatUsd(model.usd)} testId="run-cost" />
          </dl>
        </div>
      </PageHeader>
      <Gap />

      <Band grow>
        {run.status === "detached" || model.runErrors.length ? (
          <div className="mb-3 grid gap-2">
            {run.status === "detached" ? (
              <Notice tone="warn">The stream closed before the run finished. This is everything that arrived; the server keeps building, and the portfolio shows the editions once they land.</Notice>
            ) : null}
            {model.runErrors.map((e, i) => <Notice key={i} tone="flag"><span className="font-mono text-[12px] text-flag">{e.code}</span> {e.message}</Notice>)}
          </div>
        ) : null}

        <div className="grid gap-3">
          {model.lanes.length ? (
            <StoreSwitcher lanes={model.lanes} storeById={w.storeById} picked={shownId} onPick={setPicked} />
          ) : null}
          <TracePanel lane={shown} store={shown ? w.storeById(shown.storeId) : undefined} live={live} menuSource={menuSource} />
          <div className={cx("grid gap-3", skipped.length > 0 && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
            <ModelsAtWork models={model.models} total={model.usd} />
            {skipped.length ? (
              <CardBand title="Skipped" icon={<Icon name="minus" />} className="self-start">
                <p className="text-[14px] leading-5 text-ink-2">
                  {skipped.map((id) => w.storeById(id)?.name ?? id).join(", ")} already {skipped.length === 1 ? "has" : "have"} approved items this week, so the build left {skipped.length === 1 ? "it" : "them"} alone.
                </p>
                {model.finished ? <div className="mt-3"><BuildButton storeIds={skipped} force size="sm" label="Rebuild and replace approvals" /></div> : null}
              </CardBand>
            ) : null}
          </div>
        </div>
      </Band>
    </Page>
  );
}
