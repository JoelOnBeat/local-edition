"use client";

import { useState, type ReactNode } from "react";
import type { Edition, EditionItem } from "@/contract";
import { Button, CardBand, Input, Notice, StatusChip, cx } from "../ui";
import { Icon } from "../app-ui/icons";
import { GuardTag } from "../app-ui/status";
import { ThinkingDots } from "../app-ui/states";
import { formatUsd, modelName } from "../lib/format";
import { ITEM_ICON, KICKER, itemCopy } from "./item-content";
import { EvidenceTag } from "./evidence-row";
import { ItemEditor } from "./item-editor";
import type { ItemActions } from "./use-item-actions";

/** One item of the edition as a header-band card: title and status, the copy, its evidence, and approve / edit / regenerate / reject. */
export function ItemBlock({ edition, item, actions, onEvidence, readOnly, children }: {
  edition: Edition;
  item: EditionItem;
  actions: ItemActions;
  onEvidence: (item: EditionItem) => void;
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
  const k = item.kind;
  const certified = g.checkedBy === "nemo-guardrails@nebius-job";

  const footer = (
    <div className="flex w-full flex-wrap items-center gap-2">
      {!readOnly && mode === "view" ? (
        <>
          {approved ? (
            <span className="inline-flex h-8 items-center gap-1.5 pr-1 text-[14px] font-medium text-ok-ink">
              <Icon name="check" size={14} strokeWidth={2.4} />
              Approved{item.status === "edited" ? " with your edits" : ""}
            </span>
          ) : (
            <Button data-testid={`approve-${k}`} size="sm" variant="primary" loading={busy("approve")} disabled={anyBusy || g.status === "blocked" || item.status === "flagged" || item.status === "rejected"} onClick={() => actions.approve(item)}>
              Approve
            </Button>
          )}
          <Button data-testid={`edit-${k}`} size="sm" variant="secondary" disabled={anyBusy} onClick={() => setMode("edit")} icon={<Icon name="pencil" size={14} className="text-faint" />}>Edit</Button>
          <Button data-testid={`regenerate-${k}`} size="sm" variant="ghost" disabled={anyBusy} loading={busy("regen")} onClick={() => setMode("regen")} icon={<Icon name="refresh" size={14} />}>Regenerate</Button>
        </>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        <GuardTag status={g.status} short certified={certified} />
        {!readOnly && mode === "view" && !approved && item.status !== "rejected" ? (
          <Button data-testid={`reject-${k}`} size="sm" variant="ghost" disabled={anyBusy} loading={busy("reject")} onClick={() => actions.reject(item)} className="text-ink-2 hover:bg-flag-bg hover:text-flag">Reject</Button>
        ) : null}
      </span>
    </div>
  );

  return (
    <CardBand
      data-testid={`item-${k}`}
      data-status={item.status}
      data-guardrail={g.status}
      data-version={item.version}
      aria-label={KICKER[k]}
      title={KICKER[k]}
      icon={<Icon name={ITEM_ICON[k]} />}
      actions={<span data-testid={`item-status-${k}`}><StatusChip status={item.status} /></span>}
      footer={footer}
      className={cx(item.status === "rejected" && "opacity-70")}
      bodyClassName="p-5 sm:p-6"
    >
      {g.status !== "passed" ? <GuardNote k={k} item={item} /> : null}

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
        <div key={item.version} className={cx(regen?.phase === "done" && "le-write-on")}>{children}</div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-rule-subtle pt-4">
        {evidence.map((e) => <EvidenceTag key={e.id} e={e} onClick={() => onEvidence(item)} />)}
        <button type="button" data-testid={`evidence-${k}`} onClick={() => onEvidence(item)}
          className="group inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover-tint hover:text-ink">
          Why this?
          <Icon name="arrowUpRight" size={13} className="text-faint transition-[translate,color] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink-2" />
        </button>
      </div>

      {regen ? <RegenProgress testId={`regen-progress-${k}`} phase={regen.phase} steps={regen.steps} /> : null}
      {problem ? (
        <Notice tone={problem.tone} className="mt-3" data-testid={`item-problem-${k}`}
          action={problem.fix ? (
            <Button size="sm" data-testid={`item-problem-fix-${k}`} onClick={() => actions.fix(problem, item)}>{problem.fix === "reload" ? "Reload" : "Approve anyway"}</Button>
          ) : undefined}>
          {problem.message}
        </Notice>
      ) : null}

      {mode === "regen" ? (
        <form className="mt-3 flex flex-col gap-2 rounded-xl bg-paper-2 p-2 shadow-[inset_0_0_0_1px_var(--rule-subtle)] sm:flex-row sm:items-center"
          onSubmit={(e) => { e.preventDefault(); setMode("view"); void actions.regenerate(item, hint.trim() || undefined); setHint(""); }}>
          <Input data-testid={`regen-hint-${k}`} autoFocus maxLength={280} value={hint} onChange={(e) => setHint(e.target.value)}
            placeholder="Steer it (optional): less sweet, mention the park…" className="min-w-0 flex-1" />
          <div className="flex shrink-0 gap-2">
            <Button type="submit" size="sm" variant="primary" data-testid={`regen-submit-${k}`}>Regenerate</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
          </div>
        </form>
      ) : null}
    </CardBand>
  );
}

/** Guardrail diff: what was removed (and, when rewritten, what the copy says now), with the reasons. Unchecked copy gets one quiet line. */
function GuardNote({ k, item }: { k: string; item: EditionItem }) {
  const g = item.guardrail;
  if (g.status === "unchecked") {
    return (
      <div className="mb-5 flex flex-wrap items-start gap-x-2.5 gap-y-1.5 rounded-lg bg-warn-bg/40 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(180_83_9/.1)]">
        <span data-testid={`guardrail-${k}`}><GuardTag status={g.status} /></span>
        <p className="min-w-0 flex-1 basis-60 pt-0.5 text-[13px] leading-5 text-ink-2 [overflow-wrap:anywhere]">
          {g.reasons[0] ?? "Guardrails have not read this copy yet."} Read it yourself before you approve it.
        </p>
      </div>
    );
  }
  const tone = g.status === "blocked" ? "text-flag-ink" : "text-warn-ink";
  return (
    <div className="mb-5 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid={`guardrail-${k}`}><GuardTag status={g.status} /></span>
        {g.rail ? <span className="font-mono text-[12px] text-muted">{g.rail}</span> : null}
      </div>
      {g.reasons.length ? (
        <ul className={cx("grid gap-1 text-[14px] leading-5", tone)}>
          {g.reasons.map((r) => <li key={r} className="[overflow-wrap:anywhere]">{r}</li>)}
        </ul>
      ) : null}
      {g.original ? (
        <div className="overflow-hidden rounded-lg text-[15px] leading-[26px]">
          <p className="border-l-2 border-diff-del-rule bg-diff-del-bg px-4 py-2.5 text-diff-del-ink line-through decoration-diff-del-rule/60 [overflow-wrap:anywhere]">{g.original}</p>
          {g.status === "rewritten" ? (
            <p className="border-l-2 border-diff-add-rule bg-diff-add-bg px-4 py-2.5 text-diff-add-ink [overflow-wrap:anywhere]">{itemCopy(item)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RegenProgress({ phase, steps, testId }: { phase: "writing" | "checking" | "done"; steps: { model: string; usd: number; role: string }[]; testId: string }) {
  const label = phase === "writing" ? "Rewriting" : phase === "checking" ? "Checking the new copy" : "Rewritten and checked";
  return (
    <div data-testid={testId} data-phase={phase} role="status"
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-paper-2 px-3 py-2 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--rule-subtle)]">
      {phase === "done" ? <Icon name="check" size={14} strokeWidth={2.4} className="text-ok-ink" /> : <ThinkingDots className="text-accent" />}
      <span className="le-label-in font-medium text-ink" key={phase}>{label}</span>
      {steps.map((s, i) => (
        <span key={i} className="inline-flex h-6 items-center gap-1.5 rounded-md bg-white px-2 font-mono text-[11.5px] text-ink-2 shadow-ring-xs">
          {modelName(s.model)}<span className="text-faint">·</span>{formatUsd(s.usd)}
        </span>
      ))}
    </div>
  );
}
