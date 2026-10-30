import type { ReactNode } from "react";
import type { EvalResult, JobRun } from "@/contract";
import { Chip, EmptyState, cx } from "@/components/ui";
import { formatDateTime, modelName, pct } from "@/components/lib/format";

/** Building blocks of the proof page: a section frame, a stat, the guardrail eval and the Nebius job runs. */

export function Section({ id, kicker, title, lede, children }: { id: string; kicker: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid scroll-mt-20 gap-4 border-t-2 border-ink pt-5">
      <div className="grid gap-1.5">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">{kicker}</span>
        <h2 id={`${id}-h`} className="font-display text-[clamp(22px,3vw,30px)] font-extrabold leading-tight tracking-[-0.01em]">{title}</h2>
        {lede ? <p className="max-w-[70ch] text-[15px] leading-[1.55] text-ink-2">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "flag"; testId?: string }) {
  return (
    <div data-testid={testId} data-value={value} className="grid content-start gap-1 rounded-[var(--radius)] border border-rule bg-paper p-4">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="font-display text-[32px] font-extrabold leading-none tracking-[-0.02em]" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
      {sub ? <span className="font-mono text-[11.5px] text-muted">{sub}</span> : null}
    </div>
  );
}

export function EvalBlock({ result }: { result: EvalResult | null }) {
  if (!result) {
    return (
      <EmptyState
        title="No guardrail eval has run yet"
        body="The eval is a Nebius job started from the CLI, on demand. Its catch rate and false positives appear here once it posts back."
      />
    );
  }
  const misses = result.rows.filter((r) => r.expected !== r.got);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat testId="eval-catch-rate" label="Attacks caught" value={pct(result.catchRate)} sub={`${result.caught} of ${result.cases}`} tone={result.catchRate >= 0.9 ? "ok" : "warn"} />
        <Stat testId="eval-fp-rate" label="False positives" value={pct(result.falsePositiveRate)} sub={`${result.falsePositives} of ${result.benign} benign`} tone={result.falsePositiveRate <= 0.1 ? "ok" : "warn"} />
        <Stat label="Checked by" value={modelName(result.model).replace("Nemotron ", "")} sub={result.model} />
        <Stat label="Run" value={formatDateTime(result.at).split(",")[0]} sub={result.jobId} />
      </div>
      <details className="group rounded-[var(--radius)] border border-rule">
        <summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-medium text-ink-2">
          <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>
          Every phrase ({result.rows.length}){misses.length ? `, ${misses.length} got wrong` : ""}
        </summary>
        <ul className="max-h-[420px] divide-y divide-rule overflow-y-auto border-t border-rule">
          {[...misses, ...result.rows.filter((r) => r.expected === r.got)].map((r, i) => {
            const wrong = r.expected !== r.got;
            return (
              <li key={`${i}-${r.phrase}`} data-testid="eval-row" data-expected={r.expected} data-got={r.got} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className={cx("text-[14px] break-words", wrong ? "text-flag" : "text-ink")}>{r.phrase}</span>
                <span className="flex gap-1.5 font-mono text-[11.5px]">
                  <Chip mono>should {r.expected}</Chip>
                  <Chip mono tone={wrong ? "flag" : "ok"}>{r.got === "block" ? "blocked" : "passed"}</Chip>
                </span>
              </li>
            );
          })}
        </ul>
      </details>
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

export function JobRuns({ runs }: { runs: JobRun[] }) {
  if (runs.length === 0) {
    return <EmptyState title="No job runs yet" body="Runs appear here when the weekly rebuild finishes or a Nebius job is started from the CLI." />;
  }
  const sorted = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return (
    <ul className="grid gap-3">
      {sorted.map((r) => (
        <li key={r.id} data-testid="job-run" data-mode={r.mode ?? "rebuild"} data-trigger={r.trigger} data-status={r.status} className="grid gap-2 rounded-[var(--radius)] border border-rule bg-paper p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-display text-[17px] font-bold">{MODE_LABEL[r.mode ?? "rebuild"]}</span>
            <span className="flex flex-wrap gap-1.5">
              {r.trigger === "manual" ? <Chip tone="info">Started from the CLI, on demand</Chip> : <Chip>Weekly, in the Worker</Chip>}
              <Chip tone={r.status === "done" ? "ok" : r.status === "failed" ? "flag" : "warn"} dot>
                {r.status === "done" ? "Done" : r.status === "failed" ? "Failed" : "Running"}
              </Chip>
            </span>
          </div>
          <p className="text-[14px] leading-[1.5] text-ink-2">{r.note}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11.5px] sm:grid-cols-4">
            <div className="min-w-0"><dt className="text-muted">Started</dt><dd className="truncate">{formatDateTime(r.startedAt)}</dd></div>
            <div className="min-w-0"><dt className="text-muted">Took</dt><dd>{duration(r)}</dd></div>
            <div className="min-w-0"><dt className="text-muted">Nebius job</dt><dd className="truncate" title={r.nebiusJobId ?? undefined}>{r.nebiusJobId ?? "none (no Nebius call)"}</dd></div>
            <div className="min-w-0"><dt className="text-muted">Script sha256</dt><dd className="truncate" title={r.scriptSha ?? undefined}>{r.scriptSha ? r.scriptSha.slice(0, 12) : "n/a"}</dd></div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
