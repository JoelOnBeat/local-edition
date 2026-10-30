"use client";

import { useState, type ReactNode } from "react";
import type { Edition, EditionItem } from "@/contract";
import { Button, EvidenceChip, GuardrailChip, Notice, Spinner, StatusChip, cx } from "../ui";
import { formatUsd, modelName } from "../lib/format";
import { KICKER } from "./item-content";
import { ItemEditor } from "./item-editor";
import type { ItemActions } from "./use-item-actions";

/** One story on the front page: kicker and status, the copy, its evidence, and approve / edit / regenerate. */
export function ItemBlock({ edition, item, actions, onEvidence, lead, readOnly, children }: {
  edition: Edition;
  item: EditionItem;
  actions: ItemActions;
  onEvidence: (item: EditionItem) => void;
  lead?: boolean;
  readOnly?: boolean;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "regen">("view");
  const [hint, setHint] = useState("");
  const evidence = item.evidenceIds.map((id) => edition.evidence.find((e) => e.id === id)).filter((e) => e !== undefined);
  const busy = (k: string) => actions.busy === `${k}:${item.id}`;
  const anyBusy = actions.busy !== null;
  const regen = actions.regen?.itemId === item.id ? actions.regen : null;
  const problem = actions.problem?.itemId === item.id ? actions.problem : null;
  const approved = item.status === "approved" || item.status === "edited";
  const g = item.guardrail;

  return (
    <article className={cx("flex min-w-0 flex-col border-t-2 border-ink pt-3", item.status === "rejected" && "opacity-60")} aria-label={KICKER[item.kind]}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">{KICKER[item.kind]}</p>
        <StatusChip status={item.status} />
      </div>

      <div className={cx("mt-3", lead && "sm:mt-4")}>
        {mode === "edit" ? (
          <ItemEditor
            item={item}
            busy={busy("edit")}
            onCancel={() => setMode("view")}
            onSave={async (p) => {
              await actions.edit(item, p);
              setMode("view");
            }}
          />
        ) : (
          children
        )}
      </div>

      {g.status === "blocked" || g.status === "rewritten" || g.status === "unchecked" ? (
        <div className={cx("mt-4 border-l-2 pl-3 text-[13px] leading-relaxed", g.status === "blocked" ? "border-flag" : "border-warn")}>
          <GuardrailChip status={g.status} />
          {g.reasons.map((r) => <p key={r} className="mt-1.5 text-ink-2">{r}</p>)}
          {g.original ? <p className="mt-1 text-muted line-through decoration-[color-mix(in_oklab,var(--flag)_60%,transparent)]">{g.original}</p> : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {evidence.map((e) => <EvidenceChip key={e.id} evidence={e} onClick={() => onEvidence(item)} />)}
        <button type="button" onClick={() => onEvidence(item)} className="h-7 px-1 text-[12.5px] font-medium text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-ink">
          Why this?
        </button>
      </div>

      {regen ? <RegenProgress phase={regen.phase} steps={regen.steps} /> : null}
      {problem ? (
        <Notice tone={problem.tone} className="mt-3"
          action={problem.fix ? (
            <Button size="sm" onClick={() => actions.fix(problem, item)}>{problem.fix === "reload" ? "Reload" : "Approve anyway"}</Button>
          ) : undefined}>
          {problem.message}
        </Notice>
      ) : null}

      {mode === "regen" ? (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); setMode("view"); void actions.regenerate(item, hint.trim() || undefined); setHint(""); }}>
          <input
            autoFocus maxLength={280} value={hint} onChange={(e) => setHint(e.target.value)}
            placeholder="Steer it (optional): less sweet, mention the park…"
            className="h-8 min-w-0 flex-1 rounded-[var(--radius)] border border-rule bg-paper px-3 text-[13px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary">Regenerate</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {!readOnly && mode === "view" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          {approved ? (
            <span className="mr-auto text-[13px] font-medium text-ok">Approved{item.status === "edited" ? " with your edits" : ""}</span>
          ) : (
            <Button size="sm" variant="ok" loading={busy("approve")} disabled={anyBusy || g.status === "blocked" || item.status === "flagged" || item.status === "rejected"} onClick={() => actions.approve(item)}>
              Approve
            </Button>
          )}
          <Button size="sm" disabled={anyBusy} onClick={() => setMode("edit")}>Edit</Button>
          <Button size="sm" disabled={anyBusy} loading={busy("regen")} onClick={() => setMode("regen")}>Regenerate</Button>
          {!approved && item.status !== "rejected" ? (
            <Button size="sm" variant="ghost" disabled={anyBusy} loading={busy("reject")} onClick={() => actions.reject(item)} className="ml-auto">Reject</Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function RegenProgress({ phase, steps }: { phase: "writing" | "checking" | "done"; steps: { model: string; usd: number; role: string }[] }) {
  const label = phase === "writing" ? "Rewriting" : phase === "checking" ? "Checking the new copy" : "Rewritten and checked";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)] bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2" role="status">
      {phase === "done" ? <span className="h-2 w-2 rounded-full bg-ok" /> : <Spinner className="h-3.5 w-3.5" />}
      <span className="font-medium text-ink">{label}</span>
      {steps.map((s, i) => (
        <span key={i} className="font-mono text-[11.5px]">{modelName(s.model)} · {formatUsd(s.usd)}</span>
      ))}
    </div>
  );
}
