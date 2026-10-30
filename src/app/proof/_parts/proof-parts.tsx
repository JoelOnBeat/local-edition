"use client";

import { useState } from "react";
import type { EvalResult, JobRun } from "@/contract";
import { Chip, EmptyState, cx } from "@/components/ui";
import { Cell, DataRow, DataTable } from "@/components/app-ui/data-table";
import { Icon } from "@/components/app-ui/icons";
import { StatStrip } from "@/components/app-ui/stat-cells";
import { LogoTile } from "@/components/app-ui/tiles";
import { formatDateTime, modelName, pct } from "@/components/lib/format";

/** Building blocks of the proof body: the model-per-step list, the guardrail eval and the Nebius job timeline. */

export interface ProofStep { step: string; model: string; does: string; /** The last time the step was skipped for an unavailable model, until it answers again. */ skipped?: { at: string; note: string } }

const brandOf = (model: string) => (/^nvidia\//i.test(model) ? "nemotron" : /nemo guardrails/i.test(model) ? "guardrails" : null);
const GRID = "grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]";

export function ModelSteps({ steps, seen }: { steps: ProofStep[]; seen: Set<string> }) {
  return (
    <ul className="divide-y divide-rule-row">
      {steps.map((s) => {
        const brand = brandOf(s.model);
        const on = seen.has(s.model);
        return (
          <li key={s.step} data-testid="proof-model-row" data-seen={on} data-skipped={s.skipped ? "true" : undefined} className={cx("grid gap-x-6 gap-y-2 px-4 py-3.5", GRID)}>
            <div className="min-w-0">
              <p className="text-[14px] font-medium leading-5 text-ink-strong">{s.step}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-ink-2">{s.does}</p>
              {s.skipped ? (
                <p data-testid="proof-step-skipped" className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-5 text-warn-ink">
                  <Icon name="minus" size={14} className="mt-0.5 shrink-0" />
                  <span>Skipped {new Date(s.skipped.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: {s.skipped.note}</span>
                </p>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-2.5 md:justify-end">
              {brand ? <LogoTile provider={brand} size="sm" /> : <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-stone-100 text-ink-2"><Icon name="cpu" size={14} /></span>}
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-ink-strong md:text-right">{brand === "guardrails" ? s.model : modelName(s.model)}</span>
                <span className="flex items-center gap-1.5 font-mono text-[12px] text-muted md:justify-end">
                  {on ? <span className="size-1.5 shrink-0 rounded-full bg-ok" title="Seen in this workspace's editions" /> : null}
                  <span className="break-all">{s.model}</span>
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const EVAL_GRID = "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_96px_96px]";

export function EvalBlock({ result }: { result: EvalResult | null }) {
  const [all, setAll] = useState(false);
  if (!result) {
    return (
      <EmptyState
        icon={<Icon name="shield" size={20} />}
        title="No guardrail eval has run yet"
        body="The eval is a Nebius job started from the CLI, on demand. Its catch rate and false positives appear here once it posts back."
      />
    );
  }
  const misses = result.rows.filter((r) => r.expected !== r.got);
  const rows = [...misses, ...result.rows.filter((r) => r.expected === r.got)];
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <div className="grid gap-4">
      <StatStrip cols={2} cells={[
        { testId: "eval-catch-rate", icon: "shield", label: "Attacks caught", value: pct(result.catchRate), sub: `${result.caught} of ${result.cases} red-team phrases`, tone: result.catchRate >= 0.9 ? undefined : "warn" },
        { testId: "eval-fp-rate", icon: "check", label: "False positives", value: pct(result.falsePositiveRate), sub: `${result.falsePositives} of ${result.benign} ordinary lines blocked`, tone: result.falsePositiveRate <= 0.1 ? undefined : "warn" },
      ]} />
      <DataTable
        label="Every phrase in the eval"
        grid={EVAL_GRID}
        head={[{ label: `Phrase (${result.rows.length})` }, { label: "Should", className: "hidden sm:block" }, { label: "Got" }]}
        footer={
          <>
            <span className="min-w-0">
              {misses.length ? `${misses.length} got wrong, listed first.` : "Every phrase scored as expected."} Checked by {/^nvidia\//i.test(result.model) ? modelName(result.model) : result.model},{" "}
              {formatDateTime(result.at)} · <span className="font-mono text-[12px]">{result.jobId}</span>
            </span>
            {rows.length > 8 ? (
              <button type="button" onClick={() => setAll((a) => !a)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[14px] text-ink-2 hover:bg-hover-tint hover:text-ink">
                {all ? "Show fewer" : `Show all ${rows.length}`}<Icon name="chevronDown" size={14} className={cx("transition-transform", all && "rotate-180")} />
              </button>
            ) : null}
          </>
        }
      >
        {shown.map((r, i) => {
          const wrong = r.expected !== r.got;
          return (
            <DataRow key={`${i}-${r.phrase}`} grid={EVAL_GRID} data-testid="eval-row" data-expected={r.expected} data-got={r.got} className={wrong ? "bg-flag-bg/40" : undefined}>
              <Cell className={cx("text-[14px] font-normal leading-[22px] [overflow-wrap:anywhere]", wrong ? "text-flag-ink" : "text-ink-strong")}>
                {r.expected === "block" ? <mark className="rounded-[3px] bg-mark px-0.5 text-inherit">{r.phrase}</mark> : r.phrase}
              </Cell>
              <Cell className="hidden sm:block"><Chip>{r.expected === "block" ? "Block" : "Pass"}</Chip></Cell>
              <Cell><Chip tone={wrong ? "flag" : "ok"}>{r.got === "block" ? "Blocked" : "Passed"}</Chip></Cell>
            </DataRow>
          );
        })}
      </DataTable>
    </div>
  );
}

const MODE_LABEL: Record<NonNullable<JobRun["mode"]>, string> = {
  rebuild: "Weekly rebuild", certify: "NeMo Guardrails certify", eval: "Guardrail eval", import: "Store import",
};

function duration(run: JobRun): string {
  if (!run.finishedAt) return "running";
  const s = Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

/** Job runs as a timeline: a status dot on a rail, the job, its note and its facts in mono. */
export function JobRuns({ runs }: { runs: JobRun[] }) {
  if (runs.length === 0) {
    return <EmptyState icon={<Icon name="terminal" size={20} />} title="No job runs yet" body="Runs appear here when the weekly rebuild finishes or a Nebius job is started from the CLI." />;
  }
  const sorted = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return (
    <ol className="relative px-4 py-4">
      <span aria-hidden className="absolute bottom-6 left-[27px] top-6 border-l border-dashed border-stone-300" />
      {sorted.map((r) => (
        <li key={r.id} data-testid="job-run" data-mode={r.mode ?? "rebuild"} data-trigger={r.trigger} data-status={r.status} className="relative grid gap-1.5 pb-5 pl-9 last:pb-0">
          <span className={cx("absolute left-[7px] top-[3px] size-2.5 rounded-full ring-4 ring-white", r.status === "done" ? "bg-ok" : r.status === "failed" ? "bg-flag" : "le-live-dot bg-info")} aria-hidden />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[14px] font-medium text-ink-strong">{MODE_LABEL[r.mode ?? "rebuild"]}</span>
            <time className="text-[13px] text-muted tnum" dateTime={r.startedAt}>{formatDateTime(r.startedAt)}</time>
            <span className="ml-auto flex flex-wrap gap-1.5">
              {r.trigger === "manual" ? <Chip>From the CLI, on demand</Chip> : <Chip>Weekly, in the Worker</Chip>}
              <Chip tone={r.status === "done" ? "ok" : r.status === "failed" ? "flag" : "info"} dot={r.status === "running"}>
                {r.status === "done" ? "Done" : r.status === "failed" ? "Failed" : "Running"}
              </Chip>
            </span>
          </div>
          <p className="text-[14px] leading-[22px] text-ink-2">{r.note}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] text-muted">
            <span>took {duration(r)}</span>
            <span className="max-w-full truncate" title={r.nebiusJobId ?? undefined}>{r.nebiusJobId ?? "no Nebius call"}</span>
            {r.scriptSha ? <span title={r.scriptSha}>sha256 {r.scriptSha.slice(0, 12)}</span> : null}
          </p>
        </li>
      ))}
    </ol>
  );
}
