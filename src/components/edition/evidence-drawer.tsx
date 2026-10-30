"use client";

import type { BlockProfile, Edition, EditionItem, Evidence } from "@/contract";
import { Chip, Drawer, GuardrailChip, ProviderBadge, sourceProvider } from "../ui";
import { formatDateTime, formatMeters, modelName } from "../lib/format";
import { KICKER, itemHeadline } from "./item-content";

const MODE_LABEL: Record<Evidence["mode"], string> = { live: "Live call", replay: "Recorded call", fixture: "Sample data", cache: "Cached" };

/** Everything behind one item: the calls it rests on, the model that wrote it, and what guardrails did. */
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
  return (
    <Drawer open onClose={onClose} kicker={`Why this · ${KICKER[item.kind]}`} title={itemHeadline(item)} width={520}>
      <div className="space-y-6">
        {tags.length || profile ? (
          <Section title="The block's taste">
            {tags.length ? (
              <div className="mb-3 flex flex-wrap gap-1.5">{tags.map((t) => <Chip key={t} tone="accent">{t}</Chip>)}</div>
            ) : null}
            {profile ? (
              <ul className="space-y-1.5">
                {profile.tags.slice(0, 5).map((t) => (
                  <li key={t.tagId} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[13px]">
                    <span className="truncate text-ink">{t.name}</span>
                    <span className="font-mono text-[12px] text-muted">aff {t.affinity.toFixed(2)}</span>
                    <span className="w-14 text-right font-mono text-[12px] text-ok">+{t.lift.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[12px] text-muted">Lift is this block&apos;s affinity minus the New York baseline, from Qloo.</p>
          </Section>
        ) : null}

        <Section title={`Evidence (${evidence.length})`}>
          <ul className="space-y-3">
            {evidence.map((e) => <EvidenceCard key={e.id} e={e} />)}
          </ul>
        </Section>

        <Section title="Who wrote it">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted">Planned by</dt>
            <dd className="text-ink">{modelName(edition.generatedBy.agentModel)} <span className="font-mono text-[11.5px] text-muted">{edition.generatedBy.agentModel}</span></dd>
            <dt className="text-muted">Copy by</dt>
            <dd className="text-ink">{modelName(edition.generatedBy.copyModel)} <span className="font-mono text-[11.5px] text-muted">{edition.generatedBy.copyModel}</span></dd>
            <dt className="text-muted">Run</dt>
            <dd className="font-mono text-[12px] text-ink-2">{edition.generatedBy.runId} · v{item.version}</dd>
          </dl>
        </Section>

        <Section title="Guardrails">
          <div className="flex flex-wrap items-center gap-2">
            <GuardrailChip status={g.status} />
            {g.rail ? <Chip mono>{g.rail}</Chip> : null}
          </div>
          {g.reasons.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-2">{g.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
          {g.original ? (
            <p className="mt-2 rounded-[var(--radius)] bg-paper-2 px-3 py-2 text-[13px] text-muted">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em]">Original copy</span>
              <span className="line-through">{g.original}</span>
            </p>
          ) : null}
          <p className="mt-2 text-[12.5px] text-muted">
            {g.checkedBy === "nemo-guardrails@nebius-job"
              ? `Certified by NeMo Guardrails in Nebius job ${g.jobId ?? ""}${g.certifiedAt ? `, ${formatDateTime(g.certifiedAt)}` : ""}.`
              : "Checked live in the Worker (rule mirror plus a Nemotron self-check). NeMo certification runs on demand from the CLI."}
          </p>
          {item.verification ? (
            <p className="mt-2 text-[12.5px] text-ink-2">
              Evidence re-check: lift <b className="font-medium">{item.verification.lift}</b>, entities <b className="font-medium">{item.verification.entities}</b>.
            </p>
          ) : null}
        </Section>
      </div>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 border-b border-rule pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

function EvidenceCard({ e }: { e: Evidence }) {
  const m = e.metrics;
  const metrics: [string, string][] = [];
  if (m.affinity !== undefined) metrics.push(["affinity", m.affinity.toFixed(2)]);
  if (m.lift !== undefined) metrics.push(["lift", `${m.lift >= 0 ? "+" : ""}${m.lift.toFixed(2)}`]);
  if (m.popularity !== undefined) metrics.push(["popularity", m.popularity.toFixed(2)]);
  if (m.distanceM !== undefined) metrics.push(["distance", formatMeters(m.distanceM)]);
  if (m.relevance !== undefined) metrics.push(["relevance", m.relevance.toFixed(2)]);
  return (
    <li className="rounded-[var(--radius)] border border-rule p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ProviderBadge provider={sourceProvider(e.source)} />
        <Chip tone={e.mode === "live" ? "ok" : e.mode === "fixture" ? "warn" : "neutral"}>{MODE_LABEL[e.mode]}</Chip>
      </div>
      <p className="mt-2 font-mono text-[12px] text-ink">{e.endpoint}</p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{e.summary}</p>
      {metrics.length ? (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {metrics.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1.5">
              <dt className="text-[11.5px] text-muted">{k}</dt>
              <dd className="font-mono text-[13px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {Object.keys(e.params).length ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[4px] bg-paper-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
          {Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join("\n")}
        </pre>
      ) : null}
      <p className="mt-2 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
        <span>{formatDateTime(e.fetchedAt)} NY</span>
        {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">Source</a> : null}
      </p>
    </li>
  );
}
