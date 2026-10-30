import Link from "next/link";
import { SampleChainLink } from "@/components/account/session-links";
import { CardBand, Chevron, SampleBadge, StatusBar, StatusChip, StoreTile, buttonClass, cx } from "@/components/ui";
import type { LandingSample, LandingStoreRow } from "@/server/landing/types";
import { MEASURED, weekLabel } from "./landing-data";
import { SamplePending } from "./landing-pending";
import { Container, Icon, SectionHeader } from "./section";

const pct = (r: { approved: number; total: number }) => (r.total ? Math.round((r.approved / r.total) * 100) : 0);
const barTone = (r: { approved: number; total: number }): "none" | "ok" | "warn" => (r.approved === 0 ? "none" : r.approved === r.total ? "ok" : "warn");

/** The portfolio table: one row per sample store, this week's special, status, readiness and the top taste tag. */
function StoreTable({ sample }: { sample: LandingSample | null }) {
  return (
    <CardBand
      elevated flush className="min-w-0 flex-1" bodyClassName="flex flex-1 flex-col"
      title={<span className="flex items-center gap-2">This week&apos;s editions <SampleBadge>Sample</SampleBadge></span>}
      actions={<span className="hidden text-[14px] text-muted sm:inline">{sample ? `Week of ${weekLabel(sample.weekOf)}` : null}</span>}
    >
      <div role="table" aria-label="This week's editions, sample chain" className="flex flex-1 flex-col text-[14px] leading-5">
        <div role="row" className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_84px_76px] gap-6 border-b border-rule-row bg-paper-2 px-4 py-3 font-medium text-ink-strong md:grid">
          <span role="columnheader">Store</span>
          <span role="columnheader">Special</span>
          <span role="columnheader">Status</span>
          <span role="columnheader" className="text-right">Approved</span>
        </div>
        {sample ? sample.rows.map((r) => (
          <div
            key={r.id} role="row"
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-rule-row px-4 py-3.5 transition-colors duration-150 last:border-0 hover:bg-row-hover lg:flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_84px_76px] md:gap-6 md:py-4"
          >
            <span role="cell" className="flex min-w-0 items-center gap-2.5 font-medium text-ink-strong">
              <StoreTile colorIndex={r.colorIndex} name={r.name} />
              <span className="truncate">{r.name}</span>
            </span>
            <span role="cell" className="col-start-1 row-start-2 truncate pl-[34px] text-ink-2 md:col-auto md:row-auto md:pl-0 md:font-medium md:text-ink-strong">{r.special}</span>
            <span role="cell" className="col-start-2 row-start-1 md:col-auto md:row-auto">{r.status === "none" ? <span className="text-[13px] text-muted">No edition yet</span> : <StatusChip status={r.status} />}</span>
            <span role="cell" className="col-start-2 row-start-2 justify-self-end md:col-auto md:row-auto">
              <StatusBar value={pct(r)} tone={barTone(r)} label={`${r.approved} of ${r.total}`} />
            </span>
          </div>
        )) : <SamplePending className="px-4 py-6" />}
      </div>
    </CardBand>
  );
}

/** Right rail: the lift rank and the measured build. */
function Rail({ sample }: { sample: LandingSample | null }) {
  const ranked: (LandingStoreRow & { topTag: NonNullable<LandingStoreRow["topTag"]> })[] = [];
  for (const r of sample?.rows ?? []) if (r.topTag) ranked.push({ ...r, topTag: r.topTag });
  ranked.sort((a, b) => b.topTag.lift - a.topTag.lift);
  const top = ranked[0];
  return (
    <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[400px]">
      <CardBand elevated flush title="Strongest block taste">
        <div className="px-4 pb-1 pt-4">
          {top ? <p className="text-[30px] font-medium leading-9 tracking-[-0.02em] text-ink tnum">#1</p> : null}
          <div className="mt-2 flex items-center justify-between text-[14px] text-muted">
            <span>Store</span><span>Lift vs city</span>
          </div>
        </div>
        {top ? <ol>
          {ranked.slice(0, 5).map((r, i) => (
            <li key={r.id} className={cx("grid grid-cols-[20px_24px_minmax(0,1fr)_auto] items-center gap-x-2.5 px-4 py-2.5 text-[14px]", i === 0 ? "border-y border-rule bg-stone-50" : "border-b border-rule-row last:border-0")}>
              <span className="text-[12px] text-ink-2 tnum">{i + 1}</span>
              <StoreTile colorIndex={r.colorIndex} name={r.name} />
              <span className="min-w-0 truncate font-medium text-ink-strong">{r.name}<span className="font-normal text-muted"> · {r.topTag.name}</span></span>
              <StatusBar value={r.topTag.lift * 200} tone="ok" label={`+${r.topTag.lift.toFixed(2)}`} />
            </li>
          ))}
        </ol> : <SamplePending className="px-4 pb-4 pt-2" />}
        {top ? <span className="sr-only">{top.name} leads with {top.topTag.name}.</span> : null}
      </CardBand>
      <CardBand elevated className="lg:flex-1" bodyClassName="lg:flex-1" title="One live store build" actions={<span className="text-[13px] text-muted">{MEASURED.date}</span>}>
        <div className="grid grid-cols-2 divide-x divide-rule-subtle">
          <div className="pr-4">
            <p className="text-[14px] text-ink-2">Time</p>
            <p className="mt-1 text-[32px] font-medium leading-10 tracking-[-0.02em] text-ink tnum">{MEASURED.buildSeconds} s</p>
          </div>
          <div className="pl-4">
            <p className="text-[14px] text-ink-2">Model cost</p>
            <p className="mt-1 text-[32px] font-medium leading-10 tracking-[-0.02em] text-ink tnum">{MEASURED.buildCost}</p>
          </div>
        </div>
        <p className="mt-3 border-t border-rule-subtle pt-3 text-[13px] leading-5 text-muted">
          Measured on Nebius Token Factory: Nemotron Super VL drove the tools, Lightning wrote the copy.
        </p>
      </CardBand>
    </div>
  );
}

export function LandingPortfolio({ sample }: { sample: LandingSample | null }) {
  return (
    <section id="portfolio" className="relative scroll-mt-20 py-20 md:py-28">
      <Container className="px-4 sm:px-6 xl:px-7">
        <SectionHeader
          pill="Portfolio" pillIcon={Icon.grid}
          title="See every store's week at a glance."
          lede="See which stores are ready, what each one is serving, and which taste of its block it was built from."
          actions={
            <>
              <Link href="/signin" className={buttonClass("primary", "sm", "gap-1.5 pr-2.5")}>Start free<Chevron className="size-3.5" /></Link>
              <SampleChainLink className={buttonClass("secondary", "sm")} signedOutLabel="Try the sample chain" />
            </>
          }
        />
        <div className="mt-14 flex flex-col gap-3 lg:flex-row lg:items-stretch">
          <StoreTable sample={sample} />
          <Rail sample={sample} />
        </div>
      </Container>
    </section>
  );
}
