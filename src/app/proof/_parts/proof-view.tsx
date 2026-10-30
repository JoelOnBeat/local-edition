"use client";

import Link from "next/link";
import { ErrorState, Chip, Skeleton, SkeletonText, StoreSwatch } from "@/components/ui";
import { formatUsd, modelName, pct } from "@/components/lib/format";
import { useAsync } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import { EvalBlock, JobRuns, Section, Stat } from "./proof-parts";

/** What actually ran: which model did which step, the Ultra review, the guardrail eval, the Nebius jobs. */

const STEPS = [
  { step: "Edition agent", model: "nvidia/Nemotron-3.5-Super-VL", does: "Plans each store's edition and calls the Qloo, Tavily and menu tools." },
  { step: "Menu photo read", model: "nvidia/Nemotron-3.5-Super-VL", does: "Reads items and prices from a menu-board photo, then checks its own reading." },
  { step: "Copy", model: "nvidia/Nemotron-3_5-Lightning", does: "Writes the special, the sound brief, the event and the staff card in the chain's voice." },
  { step: "Live guardrail check", model: "nvidia/Nemotron-3_5-Lightning", does: "NeMo's self-check prompt on every line, inside the Worker, before anything is a draft." },
  { step: "Chain review", model: "nvidia/Nemotron-3-Ultra-550b-a55b", does: "Reads every store's edition together and flags clashes between stores." },
  { step: "Matching and ranking", model: "Qwen/Qwen3-Embedding-8B", does: "Matches the block's flavours to menu items and ranks partner places." },
  { step: "Certification", model: "NeMo Guardrails library", does: "Runs in a Nebius Serverless Job over every item and card, started from the CLI." },
];

async function load() {
  const api = getApi();
  const [proof, ws] = await Promise.all([api.getProof(), api.getWorkspace().catch(() => null)]);
  return { proof, ws };
}

export function ProofView() {
  const q = useAsync("proof", load);
  if (q.loading && !q.data) {
    return (
      <div className="grid gap-6" role="status" aria-label="Loading">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <SkeletonText lines={8} />
      </div>
    );
  }
  if (q.error || !q.data) return <ErrorState message={q.error?.message ?? "The proof did not load."} onRetry={q.reload} />;

  const { proof, ws } = q.data;
  const editions = ws?.latestEditions ?? [];
  const stores = ws?.stores ?? [];
  const reviewed = editions.filter((e) => e.review);
  const needs = reviewed.filter((e) => e.review?.verdict === "needs_change");
  const seen = new Set([...editions.map((e) => e.generatedBy.agentModel), ...editions.map((e) => e.generatedBy.copyModel), ...reviewed.map((e) => e.review!.reviewedBy)]);
  const latestCertify = proof.jobRuns.find((r) => r.mode === "certify");

  return (
    <div className="grid gap-12">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Model spend per edition" value={proof.spendPerEditionUsd === null ? "n/a" : formatUsd(proof.spendPerEditionUsd)} sub="Token Factory, averaged" />
        <Stat label="Prompt served from cache" value={proof.cachedRatio === null ? "n/a" : pct(proof.cachedRatio)} sub="Token Factory prefix cache" />
        <Stat label="Editions reviewed by Ultra" value={`${reviewed.length}/${editions.length}`} sub={`${needs.length} sent back with a change`} />
        <Stat label="Guardrail catch rate" value={proof.eval ? pct(proof.eval.catchRate) : "n/a"} sub={proof.eval ? `${pct(proof.eval.falsePositiveRate)} false positives` : "no eval yet"} />
      </div>

      <Section id="models" kicker="Model per step" title="Which model does what" lede="Every model runs on Nebius Token Factory. A green dot means this workspace's latest editions name that model as the one that ran.">
        <div className="overflow-hidden rounded-[var(--radius)] border border-rule">
          <table className="w-full border-collapse text-left text-[14px]">
            <thead className="hidden bg-paper-2 text-[11.5px] uppercase tracking-[0.08em] text-muted md:table-header-group">
              <tr><th className="px-4 py-2 font-semibold">Step</th><th className="px-4 py-2 font-semibold">Model</th><th className="px-4 py-2 font-semibold">What it does</th></tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {STEPS.map((s) => (
                <tr key={s.step} className="grid gap-1 px-4 py-3 md:table-row md:p-0">
                  <td className="font-semibold md:px-4 md:py-3">{s.step}</td>
                  <td className="md:px-4 md:py-3">
                    <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
                      {seen.has(s.model) ? <span className="h-2 w-2 shrink-0 rounded-full bg-ok" title="Seen in this workspace's editions" /> : null}
                      <span className="break-all">{s.model}</span>
                    </span>
                  </td>
                  <td className="text-ink-2 md:px-4 md:py-3">{s.does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="review" kicker="Ultra review" title={`${modelName("nvidia/Nemotron-3-Ultra-550b-a55b")} reads the whole chain`} lede="After every store's edition is drafted, the reviewer reads them side by side. It flags two stores pushing the same special, or an event that clashes with a neighbour's.">
        {reviewed.length === 0 ? (
          <p className="text-[14.5px] text-muted">No review has run on this week&apos;s editions yet. It runs from the portfolio.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {reviewed.map((e) => {
              const store = stores.find((s) => s.id === e.storeId);
              const r = e.review!;
              return (
                <li key={e.id} className="grid gap-1.5 rounded-[var(--radius)] border border-rule bg-paper p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/app/stores/${e.storeId}`} className="min-w-0 font-semibold hover:underline">
                      <StoreSwatch colorIndex={store?.colorIndex ?? 1} name={store?.name ?? e.storeId} />
                    </Link>
                    <Chip tone={r.verdict === "approve" ? "ok" : "warn"} dot>{r.verdict === "approve" ? "Approve" : "Needs a change"}</Chip>
                  </div>
                  <p className="text-[14px] leading-[1.5] text-ink-2">{r.reason}</p>
                  {r.hint ? <p className="text-[13px] text-ink"><span className="font-semibold">Change:</span> {r.hint}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="guardrails" kicker="NeMo Guardrails" title="How often the guardrails are right" lede="A red-team set of health claims, off-voice copy and prompt injections, plus ordinary lines that should pass, scored by the NeMo Guardrails library in a Nebius job.">
        <EvalBlock result={proof.eval} />
      </Section>

      <Section id="jobs" kicker="Nebius jobs" title="The latest job runs" lede={<>Certify, eval and import are Nebius Serverless Jobs, <strong className="text-ink">started from the CLI, on demand</strong>. Nothing schedules them. The weekly rebuild runs in the Worker and never calls Nebius&apos;s control plane.</>}>
        <JobRuns runs={proof.jobRuns} />
        {latestCertify ? null : <p className="text-[13.5px] text-muted">No certify run yet: items show the live check only.</p>}
      </Section>

      <p className="border-t border-rule pt-4 font-mono text-[12px] text-muted">
        Deployed from {proof.gitSha ? proof.gitSha.slice(0, 12) : "a local build"} · certify script {proof.scriptSha ? proof.scriptSha.slice(0, 12) : "not run yet"}
      </p>
    </div>
  );
}
