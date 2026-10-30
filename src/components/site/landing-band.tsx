import type { ReactNode } from "react";
import Link from "next/link";
import { SampleChainLink } from "@/components/account/session-links";
import { BrandGlyph, Chevron, StoreTile, buttonClass, cx, type Brand } from "@/components/ui";
import { SAMPLE_MENU } from "@/server/sample/chain";
import { GUARDRAIL_DIFF, MEASURED, WILLIAMSBURG } from "./landing-data";
import { LogoWall } from "./landing-integrations";
import { Stepper, type Step } from "./landing-stepper";
import { Container, Icon, Rule, SectionHeader } from "./section";
import { Rails } from "./site-chrome";

/** Dark card with a tool-call chip header (the run trace look). */
function TraceCard({ brand, label, meta, children }: { brand: Brand; label: string; meta?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-band-card shadow-[0_0_0_1px_rgb(255_255_255/.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.06] px-3.5 py-3">
        <span className="inline-flex h-[30px] min-w-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.09)]">
          <BrandGlyph brand={brand} className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{label}</span>
        </span>
        {meta ? <span className="text-[13px] text-band-ink-3 tnum">{meta}</span> : null}
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function Row({ left, right, own }: { left: ReactNode; right: ReactNode; own?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[14px] odd:bg-white/[.02]">
      <span className={cx("min-w-0 truncate", own ? "text-band-own" : "text-band-ink")}>{left}</span>
      <span className="shrink-0 text-band-ink-2 tnum">{right}</span>
    </div>
  );
}

const MENU_PICK = ["cortado", "banana-bread", "iced-latte", "chai", "nitro"];

function panes(): Step[] {
  const menu = SAMPLE_MENU.filter((m) => MENU_PICK.includes(m.id.replace("menu_", "")));
  return [
    {
      title: "Read the menu",
      body: "From Square, a photo of the menu board, or a CSV. Locations become stores; every special starts from something the chain already makes.",
      pane: (
        <TraceCard brand="square" label="square.catalog.list" meta={`${SAMPLE_MENU.length} items`}>
          {menu.map((m) => <Row key={m.id} left={m.name} right={m.price === null ? "—" : `$${m.price.toFixed(2)}`} />)}
          <p className="mt-3 px-2.5 text-[13px] text-band-ink-3">Kettle &amp; Kiln (sample chain) · 8 stores in New York</p>
        </TraceCard>
      ),
    },
    {
      title: "Read each block's taste",
      body: "Qloo says what the people around each store over-index on, and by how much against the city.",
      pane: (
        <TraceCard brand="qloo" label="qloo /v2/insights" meta="800 m radius">
          <p className="px-2.5 pb-2 text-[13px] text-band-ink-3">Around {WILLIAMSBURG.address}</p>
          {WILLIAMSBURG.tags.map((t, i) => <Row key={t.name} own={i === 0} left={t.name} right={`+${t.lift.toFixed(2)} lift`} />)}
        </TraceCard>
      ),
    },
    {
      title: "Write and check the edition",
      body: "Nemotron plans the four items with its tools; every line is checked for health claims and injected instructions before anyone reads it.",
      pane: (
        <div className="grid gap-3">
          <TraceCard brand="nvidia" label="nemotron-3.5-super-vl · plan" meta={`${MEASURED.buildSeconds} s · ${MEASURED.buildCost}`}>
            <Row own left="Special · Orange Peel Cortado" right="from Cortado" />
            <Row left="Partner · Tern & Tallow Vintage" right="2 min walk" />
            <Row left="Event · Vinyl and Cortado Night" right="Thu 19:00" />
          </TraceCard>
          <TraceCard brand="nvidia" label={`guardrails · ${GUARDRAIL_DIFF.rail}`} meta={GUARDRAIL_DIFF.store}>
            <p className="rounded-md border-l-2 border-[#8A5A3D] bg-[#2a2320] px-3 py-2 text-[14px] leading-6 text-[#d7b8a6] line-through decoration-[#d7b8a6]/60">{GUARDRAIL_DIFF.before}</p>
            <p className="mt-2 px-1 text-[13px] text-band-ink-3">{GUARDRAIL_DIFF.reason}</p>
          </TraceCard>
        </div>
      ),
    },
    {
      title: "Approve and send",
      body: "Head office approves on one map or from Slack. Each store gets a one-page staff card, an email and a calendar feed for its event night.",
      pane: (
        <div className="grid gap-3">
          <TraceCard brand="slack" label="slack · #williamsburg">
            <div className="flex gap-3 px-1">
              <StoreTile colorIndex={1} name="Williamsburg" size="lg" />
              <div className="min-w-0 text-[14px] leading-6">
                <p className="font-medium text-band-ink">This week&apos;s edition is ready</p>
                <p className="text-band-ink-2">Orange Peel Cortado · Vinyl and Cortado Night, Thu 19:00</p>
                <div className="mt-2.5 flex gap-2">
                  <span className="rounded-md bg-[#007a5a] px-2.5 py-1 text-[13px] font-medium text-white">Approve</span>
                  <span className="rounded-md px-2.5 py-1 text-[13px] text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.14)]">Regenerate</span>
                </div>
              </div>
            </div>
          </TraceCard>
          <TraceCard brand="gcal" label="calendar · williamsburg.ics">
            <Row own left="Vinyl and Cortado Night" right="Thu 19:00" />
          </TraceCard>
        </div>
      ),
    },
  ];
}

/** The dark band: how it works (four steps) and the integrations wall. */
export function LandingBand() {
  return (
    <section id="how-it-works" className="band-dither relative scroll-mt-16 text-band-ink" aria-labelledby="how-title">
      <Rails dark />
      <Container className="relative px-4 py-20 sm:px-6 md:py-28 xl:px-7">
        <SectionHeader
          dark id="how-title" pill="How it works" pillIcon={Icon.loop}
          title="From block taste to staff card, every Monday."
          lede="One agent per store reads the menu and the neighbourhood, writes the week, checks it, and waits for head office."
          actions={
            <>
              <Link href="/signin" className={buttonClass("primary", "sm", "gap-1.5 pr-2.5")}>Start free<Chevron className="size-3.5" /></Link>
              <SampleChainLink className={buttonClass("dark", "sm")} signedOutLabel="Try the sample chain" />
            </>
          }
        />
        <div className="mt-14"><Stepper steps={panes()} /></div>
      </Container>
      <Rule dark />
      <div id="integrations" className="relative scroll-mt-16">
        <Container className="px-4 py-20 sm:px-6 md:py-28 xl:px-7">
          <SectionHeader
            dark pill="Integrations" pillIcon={Icon.plug}
            title="Built on the sponsors' stack, plugged into the tools a chain runs."
            lede="Each one does a job you can see in the product."
          />
          <LogoWall className="mt-14" />
        </Container>
      </div>
    </section>
  );
}
