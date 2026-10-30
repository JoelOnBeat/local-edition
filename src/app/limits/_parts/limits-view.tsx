"use client";

import type { ProviderStatus } from "@/contract";
import { Chip, ErrorState, Skeleton, SkeletonText } from "@/components/ui";
import { formatUsd, pct } from "@/components/lib/format";
import { useAsync } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import { Section, Stat } from "../../proof/_parts/proof-parts";

/** Spend, budgets, rate limits and the places the data runs thin. */

/** Mirrors src/server/spend-budget.ts and src/server/tavily/budget.ts (30 Oct). The API does not report these yet. */
const VISITOR_BUDGETS = [
  { label: "Per workspace", value: "$0.40", note: "for the life of your private copy" },
  { label: "Per network, per day", value: "$0.80", note: "the address is hashed, never stored" },
  { label: "Held back for the demo", value: "$1.50", note: "so the sample chain and the weekly rebuild always have room" },
];
const TAVILY_TOTAL = 80;
const TAVILY_DAILY = 10;

/** Mirrors src/server/handlers/limit.ts and the menu, anchors and brand-voice routes (30 Oct). */
const RATE_LIMITS = [
  { action: "Build editions", workspace: "4, then 1 a minute", ip: "12, then 3 a minute" },
  { action: "Regenerate an item", workspace: "10, then 4 a minute", ip: "30, then 10 a minute" },
  { action: "Staff card", workspace: "10, then 5 a minute", ip: "30, then 10 a minute" },
  { action: "Edit an item", workspace: "30, then 20 a minute", ip: "90, then 40 a minute" },
  { action: "Read a menu photo", workspace: "6, then 3 a minute", ip: "shared with the workspace" },
  { action: "Search Qloo brands", workspace: "30, then 30 a minute", ip: "shared with the workspace" },
  { action: "Draft brand voice", workspace: "3, then 1 a minute", ip: "shared with the workspace" },
];

const MODE_TEXT: Record<ProviderStatus["qloo"], string> = {
  live: "Live", replay: "Recorded answers", fixture: "Sample answers", cache: "Cached answers", "missing-key": "No key: sample answers",
};

async function load() {
  const api = getApi();
  const [limits, status] = await Promise.all([api.getLimits(), api.getStatus()]);
  return { limits, status };
}

function Meter({ used, cap, label }: { used: number; cap: number; label: string }) {
  const share = cap > 0 ? Math.min(1, used / cap) : 0;
  const tone = share >= 0.9 ? "var(--flag)" : share >= 0.7 ? "var(--warn)" : "var(--ok)";
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="font-mono text-[13px] text-ink-2">{pct(share)} used</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-paper-2 ring-1 ring-rule" role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, used > 0 ? 1.5 : 0)}%`, background: tone }} />
      </div>
    </div>
  );
}

export function LimitsView() {
  const q = useAsync("limits", load);
  if (q.loading && !q.data) {
    return (
      <div className="grid gap-6" role="status" aria-label="Loading">
        <Skeleton className="h-28" />
        <SkeletonText lines={8} />
      </div>
    );
  }
  if (q.error || !q.data) return <ErrorState message={q.error?.message ?? "The limits did not load."} onRetry={q.reload} />;
  const { limits, status } = q.data;
  const { usd, capUsd } = status.spend;

  return (
    <div className="grid gap-12">
      <Section id="spend" kicker="Spend" title="The model budget" lede="Every Token Factory call is metered before it runs. When the cap is reached, calls stop with a plain message and the stored editions stay readable.">
        <div className="grid gap-4 rounded-[var(--radius)] border border-rule bg-paper p-5">
          <Meter used={usd} cap={capUsd} label="Token Factory spend, all visitors" />
          <p className="font-mono text-[13px] text-ink-2">{formatUsd(usd)} of {formatUsd(capUsd)} cap</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {VISITOR_BUDGETS.map((b) => <Stat key={b.label} label={b.label} value={b.value} sub={b.note} />)}
        </div>
        <Stat label="Average cost of one edition" value={limits.costPerEditionUsd === null ? "n/a" : formatUsd(limits.costPerEditionUsd)} sub="all model calls for one store, one week" />
      </Section>

      <Section id="budgets" kicker="Taste and search" title="Qloo and Tavily budgets" lede="Both keys are shared hackathon keys, so both are spent carefully and both have hard stops.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-3 rounded-[var(--radius)] border border-rule bg-paper p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-[19px] font-bold">Qloo</span>
              <Chip tone={status.qloo === "live" ? "ok" : "warn"} mono>{MODE_TEXT[status.qloo]}</Chip>
            </div>
            <p className="text-[14px] leading-[1.55] text-ink-2">
              Every Qloo answer is stored and reused, so judges read stored editions and regenerating an item never calls Qloo again.
              Live calls stop at a hard cap. Only coordinates, brand ids and tag ids go to Qloo.
            </p>
          </div>
          <div className="grid content-start gap-3 rounded-[var(--radius)] border border-rule bg-paper p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-[19px] font-bold">Tavily</span>
              <Chip tone={status.tavily === "live" ? "ok" : "warn"} mono>{MODE_TEXT[status.tavily]}</Chip>
            </div>
            <Meter used={limits.tavilyCreditsUsed} cap={TAVILY_TOTAL} label={`${limits.tavilyCreditsUsed} of ${TAVILY_TOTAL} credits`} />
            <p className="text-[14px] leading-[1.55] text-ink-2">
              At most {TAVILY_DAILY} credits a day, enough for one full eight-store build. Past that, event nights use this week&apos;s saved listings.
            </p>
          </div>
        </div>
      </Section>

      <Section id="rate" kicker="Rate limits" title="How fast you can push it" lede="A burst, then a steady refill. Past it, the app asks you to wait a moment.">
        <div className="overflow-hidden rounded-[var(--radius)] border border-rule">
          <table className="w-full border-collapse text-left text-[14px]">
            <thead className="bg-paper-2 text-[11.5px] uppercase tracking-[0.08em] text-muted">
              <tr><th className="px-4 py-2 font-semibold">Action</th><th className="px-4 py-2 font-semibold">Per workspace</th><th className="hidden px-4 py-2 font-semibold sm:table-cell">Per network</th></tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {RATE_LIMITS.map((r) => (
                <tr key={r.action}>
                  <td className="px-4 py-2.5">{r.action}</td>
                  <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink-2">{r.workspace}</td>
                  <td className="hidden px-4 py-2.5 font-mono text-[12.5px] text-ink-2 sm:table-cell">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="quality" kicker="Where it falls short" title="What the checks caught this week" lede="An item with no evidence behind it is dropped before head office sees it. Here is how often that, and everything else, happened.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Items dropped for missing evidence" value={String(limits.droppedForEvidence)} />
          <Stat label="Lines blocked by guardrails" value={String(limits.guardrailBlocks)} />
          <Stat label="Guardrail false positives" value={limits.falsePositiveRate === null ? "n/a" : pct(limits.falsePositiveRate)} sub="from the last eval" />
        </div>
        <div className="grid gap-2">
          <h3 className="font-display text-[18px] font-bold">Where Qloo&apos;s data runs thin</h3>
          {limits.qlooCoverageGaps.length === 0 ? (
            <p className="text-[14.5px] text-muted">No gaps reported for this week&apos;s stores.</p>
          ) : (
            <ul className="grid gap-2">
              {limits.qlooCoverageGaps.map((g) => (
                <li key={g} className="flex gap-3 rounded-[var(--radius)] border border-rule bg-paper px-4 py-3 text-[14.5px] leading-[1.5] text-ink-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                  <span className="min-w-0 break-words">{g}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}
