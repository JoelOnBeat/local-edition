"use client";

import type { ReactNode } from "react";
import type { ProviderStatus } from "@/contract";
import { CardBand, Chip, ErrorState, Skeleton } from "@/components/ui";
import { StatStrip, TableFrame, UsageMeter } from "@/components/app-ui/stat-cells";
import { LogoTile } from "@/components/app-ui/tiles";
import { formatUsd, pct } from "@/components/lib/format";
import { useAsync } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";

/**
 * The body of the limits page: what is used against every cap, per-visitor budgets, rate limits and where the data runs
 * thin. One white article frame with numbered sections (DESIGN-SYSTEM §10.12), self-contained for the public page and the app.
 */

const MODE_TEXT: Record<ProviderStatus["qloo"], string> = {
  live: "Live", replay: "Recorded answers", fixture: "Sample answers", cache: "Cached answers", "missing-key": "No key: sample answers",
};

async function load() {
  const api = getApi();
  const [limits, status] = await Promise.all([api.getLimits(), api.getStatus()]);
  return { limits, status };
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-4 border-t border-rule-subtle pt-7 first:border-t-0 first:pt-0 md:grid-cols-[200px_minmax(0,1fr)]">
      <h2 className="text-[18px] font-medium leading-[26px] tracking-[-0.01em] text-ink">{n}. {title}</h2>
      <div className="grid min-w-0 content-start gap-5 text-[16px] leading-[26px] text-ink-2 [overflow-wrap:anywhere] [&_strong]:font-medium [&_strong]:text-ink">{children}</div>
    </section>
  );
}

const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1.3fr)_90px_90px_minmax(0,1fr)]";

function MeterRow({ service, cap, used, children }: { service: ReactNode; cap: string; used: string; children: ReactNode }) {
  return (
    <div className={`${ROW} border-b border-rule-row last:border-0`}>
      <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-ink-strong">{service}</span>
      <span className="hidden text-[14px] text-ink-2 tnum sm:block">{cap}</span>
      <span className="text-right text-[14px] font-medium text-ink-strong tnum sm:text-left">{used}</span>
      <span className="col-span-2 sm:col-span-1">{children}</span>
    </div>
  );
}

export function LimitsView() {
  const q = useAsync("limits", load);
  if (q.loading && !q.data) {
    return (
      <div className="ring-after relative grid gap-6 rounded-xl bg-white px-6 py-8 md:px-8 md:py-10" role="status" aria-label="Loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-3 md:grid-cols-[200px_1fr]"><Skeleton className="h-4 w-36 rounded-full" /><div className="grid gap-2.5"><Skeleton className="h-3 w-full rounded-full" /><Skeleton className="h-3 w-2/3 rounded-full" /><Skeleton className="h-2 w-full rounded-full" /></div></div>
        ))}
      </div>
    );
  }
  if (q.error || !q.data) {
    return <div data-testid="limits-error"><CardBand title="Limits" flush><ErrorState message={q.error?.message ?? "The limits did not load."} onRetry={q.reload} /></CardBand></div>;
  }
  const { limits, status } = q.data;
  const { usd, capUsd } = status.spend;
  const { tavily, qloo, rateLimits, visitorBudgets } = limits;

  return (
    <article className="ring-after relative grid gap-7 rounded-xl bg-white px-5 py-8 sm:px-6 md:px-8 md:py-10">
      <Section n={1} title="Used so far">
        <p>Every Token Factory call is metered before it runs. At a cap, calls stop with a plain message and the stored editions stay readable.</p>
        <TableFrame>
          <div className={`${ROW} border-b border-rule-row py-2.5 text-[12px] font-medium text-muted`}>
            <span>Service</span><span className="hidden sm:block">Cap</span><span className="text-right sm:text-left">Used</span><span className="hidden sm:block" />
          </div>
          <MeterRow service={<><LogoTile provider="tokenfactory" size="sm" />Token Factory spend</>} cap={formatUsd(capUsd)} used={formatUsd(usd)}>
            <UsageMeter testId="limits-spend" used={usd} cap={capUsd} label="Token Factory spend, all visitors" />
          </MeterRow>
          {qloo ? (
            <MeterRow service={<><LogoTile provider="qloo" size="sm" />Qloo live calls</>} cap={String(qloo.cap)} used={String(qloo.used)}>
              <UsageMeter testId="limits-qloo" used={qloo.used} cap={qloo.cap} label={`${qloo.used} of ${qloo.cap} live calls`} />
            </MeterRow>
          ) : null}
          <MeterRow service={<><LogoTile provider="tavily" size="sm" />Tavily credits</>} cap={String(tavily.cap)} used={String(tavily.used)}>
            <UsageMeter testId="limits-tavily" used={tavily.used} cap={tavily.cap} label={`${tavily.used} of ${tavily.cap} credits`} />
          </MeterRow>
        </TableFrame>
        <StatStrip cols={2} cells={[
          { testId: "limits-cost-per-edition", icon: "coins", label: "Average cost of one edition", value: limits.costPerEditionUsd === null ? "n/a" : formatUsd(limits.costPerEditionUsd), sub: "All model calls for one store, one week" },
          { icon: "gauge", label: "Spend so far", value: `${pct(capUsd ? Math.min(1, usd / capUsd) : 0)}`, sub: `${formatUsd(usd)} of the ${formatUsd(capUsd)} cap, all visitors` },
        ]} />
      </Section>

      <Section n={2} title="Per-visitor budgets">
        <p>Each private copy has its own small budget, so one visitor cannot spend everyone else&apos;s.</p>
        <StatStrip cols={3} cells={[
          { icon: "user", label: "Per workspace", value: formatUsd(visitorBudgets.workspaceUsd), sub: "For the life of your private copy" },
          { icon: "link", label: "Per network, per day", value: formatUsd(visitorBudgets.networkDailyUsd), sub: "The address is hashed, never stored" },
          { icon: "shield", label: "Held back for the demo", value: formatUsd(visitorBudgets.demoFloorUsd), sub: "The sample chain and weekly rebuild keep room" },
        ]} />
      </Section>

      <Section n={3} title="Qloo calls">
        <p className="flex flex-wrap items-center gap-2">
          <Chip data-testid="limits-qloo-mode" data-mode={status.qloo} tone={status.qloo === "live" ? "ok" : "warn"}>{MODE_TEXT[status.qloo]}</Chip>
          {qloo ? <span data-testid="limits-qloo-today" className="text-[14px] text-ink-2 tnum">{qloo.dailyUsed} of {qloo.dailyCap} today</span>
            : <span data-testid="limits-qloo-unread" className="text-[14px] text-muted">The live-call counter could not be read just now.</span>}
        </p>
        <p>
          Every Qloo answer is stored and reused, so judges read stored editions and regenerating an item never calls Qloo again. Live calls stop
          at a hard cap of <strong>{qloo?.cap ?? 2000}</strong>, at most <strong>{qloo?.dailyCap ?? 200} a day</strong>. Only coordinates, brand ids and tag ids go to Qloo.
        </p>
      </Section>

      <Section n={4} title="Tavily search">
        <p className="flex flex-wrap items-center gap-2">
          <Chip data-testid="limits-tavily-mode" data-mode={status.tavily} tone={status.tavily === "live" ? "ok" : "warn"}>{MODE_TEXT[status.tavily]}</Chip>
          <span data-testid="limits-tavily-today" className="text-[14px] text-ink-2 tnum">{tavily.dailyUsed} of {tavily.dailyCap} today</span>
        </p>
        <p>At most <strong>{tavily.dailyCap} credits a day</strong>, enough for one full eight-store build. Past that, event nights use this week&apos;s saved listings.</p>
      </Section>

      <Section n={5} title="Rate limits">
        <p>A burst, then a steady refill. Past it, the app asks you to wait a moment.</p>
        <TableFrame>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 border-b border-rule-row px-4 py-2.5 text-[12px] font-medium text-muted sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <span>Action</span><span>Per workspace</span><span className="hidden sm:block">Per network</span>
          </div>
          {rateLimits.map((r) => (
            <div key={r.action} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 border-b border-rule-row px-4 py-3 text-[14px] last:border-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <span className="font-medium text-ink-strong">{r.action}</span>
              <span className="text-ink-2 tnum">{r.workspace}</span>
              <span className="hidden text-ink-2 tnum sm:block">{r.ip}</span>
            </div>
          ))}
        </TableFrame>
      </Section>

      <Section n={6} title="Where it falls short">
        <p>An item with no evidence behind it is dropped before head office sees it. This is how often that, and everything else, happened.</p>
        <StatStrip cols={3} cells={[
          { testId: "limits-dropped", icon: "x", label: "Dropped for missing evidence", value: String(limits.droppedForEvidence) },
          { testId: "limits-blocked", icon: "shield", label: "Lines blocked by guardrails", value: String(limits.guardrailBlocks) },
          { testId: "limits-fp-rate", icon: "scale", label: "Guardrail false positives", value: limits.falsePositiveRate === null ? "n/a" : pct(limits.falsePositiveRate), sub: "From the last eval" },
        ]} />
        <div className="grid gap-2">
          <h3 className="text-[16px] font-medium leading-6 text-ink">Where Qloo&apos;s data runs thin</h3>
          {limits.qlooCoverageGaps.length === 0 ? (
            <p className="text-[15px] text-muted">No gaps reported for this week&apos;s stores.</p>
          ) : (
            <ul className="grid gap-2">
              {limits.qlooCoverageGaps.map((g) => (
                <li key={g} data-testid="limits-gap" className="flex gap-3 text-[15px] leading-6">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                  <span className="min-w-0">{g}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </article>
  );
}
