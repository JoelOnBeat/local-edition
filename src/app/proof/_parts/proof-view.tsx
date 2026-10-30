"use client";

import Link from "next/link";
import { CardBand, ErrorState, Skeleton, StatusBar, StoreTile } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { StatStrip } from "@/components/app-ui/stat-cells";
import { SkeletonRows } from "@/components/app-ui/states";
import { IconTag } from "@/components/app-ui/status";
import { formatDate, formatUsd, modelName, pct } from "@/components/lib/format";
import { useAsync } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import { EvalBlock, JobRuns, ModelSteps } from "./proof-parts";

/**
 * The body of the proof page: what actually ran (model per step, the Ultra review, the NeMo Guardrails eval, the Nebius
 * jobs). Self-contained cards, so it sits in the public page and inside the app alike. Every number comes from /api/proof.
 */
const load = () => getApi().getProof();

export function ProofView() {
  const q = useAsync("proof", load);
  if (q.loading && !q.data) {
    return (
      <div className="grid gap-3" role="status" aria-label="Loading">
        <div className="grid gap-px overflow-hidden rounded-lg bg-rule-subtle shadow-ring-xs sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="grid gap-3 bg-white p-5"><Skeleton className="h-3 w-32 rounded-full" /><Skeleton className="h-8 w-20" /></div>)}
        </div>
        <CardBand title="Which model does what" flush><SkeletonRows rows={6} cols={2} /></CardBand>
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div data-testid="proof-error">
        <CardBand title="Proof" flush><ErrorState message={q.error?.message ?? "The proof did not load."} onRetry={q.reload} /></CardBand>
      </div>
    );
  }

  const proof = q.data;
  const reviewed = proof.reviews;
  const needs = reviewed.filter((r) => r.verdict === "needs_change");
  const ev = proof.eval;
  const latestCertify = proof.jobRuns.find((r) => r.mode === "certify");

  return (
    <div className="grid gap-3">
      <StatStrip cells={[
        {
          testId: "proof-catch-rate", icon: "shield", label: "Guardrail catch rate", value: ev ? pct(ev.catchRate) : "n/a",
          visual: ev ? <StatusBar value={ev.catchRate * 100} label={`${ev.caught} of ${ev.cases} attacks`} className="text-[13px]" /> : undefined,
          sub: ev ? `${pct(ev.falsePositiveRate)} false positives` : "No eval has run yet",
        },
        {
          testId: "proof-reviewed", icon: "layers", label: "Editions reviewed by Ultra", value: `${reviewed.length}/${proof.editionCount}`,
          sub: proof.editionCount ? `${needs.length} sent back with a change` : "No editions this week yet",
        },
        { testId: "proof-spend-per-edition", icon: "coins", label: "Model spend per edition", value: proof.spendPerEditionUsd === null ? "n/a" : formatUsd(proof.spendPerEditionUsd), sub: "Token Factory, averaged" },
        { testId: "proof-cached-ratio", icon: "bolt", label: "Prompt served from cache", value: proof.cachedRatio === null ? "n/a" : pct(proof.cachedRatio), sub: "Token Factory prefix cache" },
      ]} />

      <CardBand id="guardrails" title="NeMo Guardrails: how often they are right" icon={<Icon name="shield" />} flush={!ev} className="scroll-mt-24">
        <EvalBlock result={ev} />
      </CardBand>

      <CardBand id="models" title="Which model does what" icon={<Icon name="cpu" />} flush className="scroll-mt-24"
        footer={<span>Every model runs on Nebius Token Factory. A green dot: this workspace&apos;s latest editions name it.</span>}>
        <ModelSteps steps={proof.steps} seen={new Set(proof.seenModels)} />
      </CardBand>

      <CardBand id="review" title={`${modelName("nvidia/Nemotron-3-Ultra-550b-a55b")} reads the whole chain`} icon={<Icon name="layers" />} flush={reviewed.length === 0} className="scroll-mt-24" bodyClassName={reviewed.length ? "p-2" : undefined}
        footer={reviewed.length ? <span data-testid="proof-review-date">{proof.sample ? "The sample chain's review" : "Review"}, read {formatDate(reviewed.map((r) => r.reviewedAt).sort().at(-1)!)}. {proof.sample ? "One real Ultra read of the sample editions, copied into every sample workspace." : ""}</span> : undefined}>
        {reviewed.length === 0 ? (
          <p className="px-6 py-10 text-center text-[14px] leading-5 text-ink-2">No review has run on this week&apos;s editions yet. It runs after every build, reading all stores side by side.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {reviewed.map((r) => (
              <li key={r.storeId} data-testid="proof-review" data-store-id={r.storeId} data-verdict={r.verdict} className="grid content-start gap-2 rounded-lg bg-paper-2 p-4 shadow-[inset_0_0_0_1px_var(--rule-subtle)]">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/app/stores/${r.storeId}`} className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-ink-strong hover:underline hover:decoration-stone-300 hover:underline-offset-[3px]">
                    <StoreTile colorIndex={r.colorIndex} name={r.storeName} size="lg" />
                    <span className="truncate">{r.storeName}</span>
                  </Link>
                  {r.verdict === "approve" ? <IconTag tone="ok" icon="check">Clears</IconTag> : <IconTag tone="warn" icon="pencil">Wants a change</IconTag>}
                </div>
                <p className="text-[14px] leading-[22px] text-ink-2">{r.reason}</p>
                {r.hint ? <p className="rounded-md bg-warn-bg/60 px-2.5 py-1.5 text-[13px] leading-5 text-warn-ink"><span className="font-medium">Change:</span> {r.hint}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardBand>

      <CardBand id="jobs" title="Nebius jobs, started from the CLI on demand" icon={<Icon name="terminal" />} flush className="scroll-mt-24"
        footer={<span>Nothing schedules them. The weekly rebuild runs in the Worker and never calls Nebius&apos;s control plane.{latestCertify ? "" : " No certify run yet: items show the live check only."}</span>}>
        <JobRuns runs={proof.jobRuns} />
      </CardBand>

      <p className="px-1 pt-1 font-mono text-[12px] text-muted">
        Deployed from {proof.gitSha ? proof.gitSha.slice(0, 12) : "a local build"} · certify script {proof.scriptSha ? proof.scriptSha.slice(0, 12) : "not run yet"}
      </p>
    </div>
  );
}
