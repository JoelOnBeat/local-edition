"use client";

import type { ReactNode } from "react";
import type { BlockProfile, Edition, EditionItem } from "@/contract";
import { Drawer } from "../ui";
import { Icon } from "../app-ui/icons";
import { GuardTag, ScorePill, signed } from "../app-ui/status";
import { LogoTile } from "../app-ui/tiles";
import { isNvidia } from "./store-chip";
import { formatDateTime, modelName } from "../lib/format";
import { EvidenceRow } from "./evidence-row";
import { ITEM_ICON, KICKER, itemHeadline } from "./item-content";

/** Everything behind one item: the block's Qloo taste, the calls it rests on, the models that wrote it, and what guardrails did. */
export function EvidenceDrawer({ edition, item, profile, onClose }: {
  edition: Edition;
  item: EditionItem | null;
  profile?: BlockProfile;
  onClose: () => void;
}) {
  if (!item) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;
  const evidence = item.evidenceIds.map((id) => edition.evidence.find((e) => e.id === id)).filter((e) => e !== undefined);
  const g = item.guardrail;
  const tags = item.kind === "special" ? item.flavourTags : [];
  const certified = g.checkedBy === "nemo-guardrails@nebius-job";

  return (
    <Drawer
      open
      onClose={onClose}
      width={560}
      kicker={
        <span className="mb-1.5 inline-flex h-7 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[13px] font-medium text-ink-strong shadow-raised">
          <Icon name={ITEM_ICON[item.kind]} size={14} className="text-faint" />Evidence · {KICKER[item.kind]}
        </span>
      }
      title={itemHeadline(item)}
    >
      <div className="grid gap-6">
        {tags.length || profile ? (
          <Section title="The block's taste" right={<span className="flex items-center gap-1.5 text-[12px] text-muted"><LogoTile provider="qloo" size="xs" />lift vs New York</span>}>
            {tags.length ? (
              <div className="mb-3 flex flex-wrap gap-1.5">{tags.map((t) => <ScorePill key={t} tone="accent">{t}</ScorePill>)}</div>
            ) : null}
            {profile?.tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {profile.tags.slice(0, 8).map((t) => (
                  <ScorePill key={t.tagId} score={signed(t.lift)} title={`affinity ${t.affinity.toFixed(2)}, lift ${signed(t.lift)}`}>{t.name}</ScorePill>
                ))}
              </div>
            ) : null}
            <p className="mt-3 text-[13px] leading-5 text-muted">Lift is this block&apos;s Qloo affinity minus the New York baseline.</p>
          </Section>
        ) : null}

        <Section title={`Evidence (${evidence.length})`}>
          <ul className="grid gap-2">{evidence.map((e) => <EvidenceRow key={e.id} e={e} />)}</ul>
        </Section>

        <Section title="Who wrote it">
          <dl className="divide-y divide-rule-row rounded-xl bg-white text-[14px] shadow-ring-xs">
            <ModelRow label="Planned by" model={edition.generatedBy.agentModel} />
            <ModelRow label="Copy by" model={edition.generatedBy.copyModel} />
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-ink-2">Run</dt>
              <dd className="truncate font-mono text-[12px] text-ink-2">{edition.generatedBy.runId} · v{item.version}</dd>
            </div>
          </dl>
        </Section>

        <Section title="Guardrails" right={<GuardTag status={g.status} certified={certified} />}>
          <div className="rounded-xl bg-white p-4 shadow-ring-xs">
            <div className="flex flex-wrap items-center gap-2">
              <LogoTile provider="guardrails" size="sm" />
              <span className="text-[14px] font-medium text-ink-strong">NeMo Guardrails</span>
              {g.rail ? <span className="font-mono text-[12px] text-muted">{g.rail}</span> : null}
            </div>
            {g.reasons.length ? <ul className="mt-2 grid gap-1 text-[14px] leading-5 text-ink-2">{g.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
            {g.original ? (
              <p className="mt-3 rounded-lg border-l-2 border-diff-del-rule bg-diff-del-bg px-3 py-2 text-[14px] leading-[22px] text-diff-del-ink line-through decoration-diff-del-rule/60 [overflow-wrap:anywhere]">{g.original}</p>
            ) : null}
            <p className="mt-3 text-[13px] leading-5 text-muted">
              {certified
                ? `Certified by NeMo Guardrails in Nebius job ${g.jobId ?? ""}${g.certifiedAt ? `, ${formatDateTime(g.certifiedAt)}` : ""}.`
                : "Checked live in the Worker (rule mirror plus a Nemotron self-check). NeMo certification runs on demand from the CLI."}
            </p>
            {item.verification ? (
              <p className="mt-2 text-[13px] leading-5 text-ink-2">
                Evidence re-check: lift <span className="font-mono">{item.verification.lift}</span>, entities <span className="font-mono">{item.verification.entities}</span>.
              </p>
            ) : null}
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-medium leading-5 text-ink-strong">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function ModelRow({ label, model }: { label: string; model: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        {isNvidia(model) ? <LogoTile provider="nemotron" size="xs" /> : null}
        <span className="font-medium text-ink-strong">{modelName(model)}</span>
        <span className="hidden truncate font-mono text-[11.5px] text-muted sm:inline">{model}</span>
      </dd>
    </div>
  );
}
