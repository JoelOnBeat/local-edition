"use client";

import { ErrorLine } from "@/components/account/plain";
import { useFirstBuild } from "@/components/account/use-build";
import { Button, StatusChip, StoreTile, cx } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { ThinkingDots } from "@/components/app-ui/states";
import type { StepProps } from "../step-props";

const PHASE: Record<string, string> = {
  idle: "Ready when you are", building: "The agent is writing every store's edition", built: "Drafted. Approve them to finish",
  approving: "Approving every edition", approved: "Approved. The staff cards are live",
};

/** Build the first editions (one agent run for every store), then approve them. */
export function BuildStep({ step, refresh, bundle }: StepProps) {
  const first = useFirstBuild(refresh);
  const working = first.phase === "building" || first.phase === "approving";
  const storeOf = (id: string) => bundle.stores.find((s) => s.id === id);
  return (
    <div className="grid gap-4">
      <p className="text-[14px] leading-5 text-ink-2">
        One agent run reads each block&apos;s taste from Qloo, drafts a special, a sound brief, a partner and an event night per store, and checks every line with guardrails.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="build-start" variant="primary" size="lg" chevron={!working} loading={first.phase === "building"} disabled={step.blockedBy.length > 0 || working} onClick={() => void first.build()}>
          Build the first editions
        </Button>
        <p data-testid="build-phase" data-phase={first.phase} className={cx("inline-flex items-center gap-2 text-[14px]", first.phase === "approved" ? "font-medium text-ok-ink" : "text-ink-2")}>
          {working ? <ThinkingDots className="text-accent" /> : first.phase === "approved" ? <Icon name="check" size={14} /> : null}
          {PHASE[first.phase] ?? first.phase}
        </p>
      </div>
      <ol data-testid="build-log" className={first.log.length ? "max-h-[180px] overflow-y-auto rounded-lg bg-band px-3.5 py-3 font-mono text-[12.5px] leading-5 text-band-ink-2" : "hidden"}>
        {first.log.map((l, i) => (
          <li key={i} className="le-enter flex gap-2"><span className="text-band-ink-3">→</span><span className={l.startsWith("store_done") ? "text-band-own" : undefined}>{l}</span></li>
        ))}
      </ol>
      {first.editions.length ? (
        <>
          <ul data-testid="build-editions" className="overflow-hidden rounded-lg bg-white shadow-ring-xs">
            {first.editions.map((e) => {
              const s = storeOf(e.storeId);
              return (
                <li key={e.id} data-testid="build-edition" data-status={e.status} className="flex items-center gap-3 border-b border-rule-row px-3.5 py-2.5 last:border-0">
                  {s ? <StoreTile colorIndex={s.colorIndex} name={s.name} size="md" /> : null}
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-strong">{s?.name ?? e.storeId}</span>
                  <StatusChip status={e.status} />
                </li>
              );
            })}
          </ul>
          <div>
            <Button data-testid="build-approve-all" variant="primary" size="sm" loading={first.phase === "approving"} disabled={first.phase === "approving" || first.phase === "approved"} onClick={() => void first.approveAll()}>
              Approve all editions
            </Button>
          </div>
        </>
      ) : null}
      <ErrorLine error={first.error} testId="build-error" />
    </div>
  );
}
