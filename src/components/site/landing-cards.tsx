import Link from "next/link";
import type { ReactNode } from "react";
import { BrandGlyph, Chip, SampleBadge, StoreTile, type Brand } from "@/components/ui";
import { MEASURED } from "./landing-data";
import { Icon } from "./section";

function FeatureCard({ preview, title, body }: { preview: ReactNode; title: string; body: ReactNode }) {
  return (
    <div>
      <div className="flex h-[232px] items-center justify-center overflow-hidden rounded-2xl bg-paper-2 p-2.5 shadow-[inset_0_0_0_1px_var(--rule)]">{preview}</div>
      <h3 className="mt-5 text-[16px] font-medium leading-6 text-ink">{title}</h3>
      <p className="mt-1 max-w-[340px] text-[16px] leading-6 text-ink-2">{body}</p>
    </div>
  );
}

/** Staff card preview: the phone page a store sees. */
function StaffCardPreview() {
  const rows: Array<[string, string, string]> = [
    ["This week's special", "Orange Peel Cortado", "Peel cut fresh each morning"],
    ["On the speakers", "Big Thief, Yo La Tengo", "Low until noon"],
    ["Event", "Vinyl and Cortado Night", "Thu 19:00"],
  ];
  return (
    <div className="w-[236px] translate-y-6 rounded-[18px] bg-white p-1.5 shadow-ring-lg">
      <div className="flex items-center gap-2 px-2.5 pb-2 pt-2">
        <StoreTile colorIndex={1} name="Williamsburg" size="sm" />
        <span className="text-[12px] font-medium text-ink">Williamsburg</span>
        <SampleBadge className="ml-auto h-[18px] px-1.5 text-[10px]">Sample</SampleBadge>
      </div>
      {rows.map(([label, title, meta]) => (
        <div key={label} className="border-t border-rule-subtle px-2.5 py-2">
          <p className="text-[11px] font-medium text-muted">{label}</p>
          <p className="text-[13px] font-medium leading-5 text-ink">{title}</p>
          <p className="text-[11px] text-ink-2">{meta}</p>
        </div>
      ))}
    </div>
  );
}

const LOG: Array<{ t: string; brand?: Brand; text: string; tone?: "ok" | "flag" | "neutral"; chip: string }> = [
  { t: "08:00", text: "Monday build started", chip: "Cron", tone: "neutral" },
  { t: "08:02", brand: "nvidia", text: "Astoria special rewritten", chip: "Rewritten", tone: "flag" },
  { t: "09:14", brand: "slack", text: "Williamsburg approved", chip: "Approved", tone: "ok" },
  { t: "09:15", brand: "gmail", text: "Staff card emailed", chip: "Sent", tone: "ok" },
];

/** Sync-log timeline: what moved between Local Edition and the store's tools. */
function SyncLogPreview() {
  return (
    <div className="w-full max-w-[300px] rounded-xl bg-white px-3.5 py-3 shadow-ring-xs">
      <ol className="relative">
        <span aria-hidden className="absolute bottom-3 left-[44.5px] top-3 w-px border-l border-dashed border-stone-300" />
        {LOG.map((e) => (
          <li key={e.t + e.text} className="relative flex items-center gap-2.5 py-1.5 text-[12px]">
            <span className="w-[26px] shrink-0 text-faint tnum">{e.t}</span>
            <span className="relative z-10 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-white shadow-ring-xs">
              {e.brand ? <BrandGlyph brand={e.brand} colored className="size-3" /> : <span className="size-1.5 rounded-full bg-faint" />}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-ink-strong">{e.text}</span>
            <Chip tone={e.tone} className="h-5 px-1.5 text-[11px]">{e.chip}</Chip>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The recorded NeMo eval as marks: 40 caught, 10 ordinary lines passed. */
function ProofPreview() {
  return (
    <div className="w-full max-w-[300px] rounded-xl bg-white p-3.5 shadow-ring-xs">
      <p className="flex items-center justify-between text-[12px] font-medium text-ink-strong">
        Red-team phrases caught <span className="tnum text-ok-ink">{MEASURED.redTeamCaught}/{MEASURED.redTeamTotal}</span>
      </p>
      <div className="mt-2 grid grid-cols-[repeat(20,minmax(0,1fr))] gap-[3px]" aria-hidden>
        {Array.from({ length: MEASURED.redTeamTotal }, (_, i) => <span key={i} className="h-3.5 rounded-full bg-ok-meter" />)}
      </div>
      <p className="mt-3.5 flex items-center justify-between text-[12px] font-medium text-ink-strong">
        Ordinary lines blocked <span className="tnum text-ink-2">{MEASURED.benignBlocked}/{MEASURED.benignTotal}</span>
      </p>
      <div className="mt-2 grid grid-cols-[repeat(20,minmax(0,1fr))] gap-[3px]" aria-hidden>
        {Array.from({ length: MEASURED.benignTotal }, (_, i) => <span key={i} className="h-3.5 rounded-full bg-rule" />)}
      </div>
      <p className="mt-3 truncate font-mono text-[10.5px] text-muted">{MEASURED.nemoJob}</p>
    </div>
  );
}

export function LandingCards() {
  return (
    <div className="mt-20 grid gap-x-8 gap-y-12 md:grid-cols-3">
      <FeatureCard preview={<StaffCardPreview />} title="A staff card on any phone" body="One page per store: the special, the music, the partner and the night. No app, no login." />
      <FeatureCard preview={<SyncLogPreview />} title="Every send, in one log" body={<>What went to Square, Slack and each inbox, and what came back. <span className="text-muted">(Sample timeline.)</span></>} />
      <FeatureCard
        preview={<ProofPreview />}
        title="Guardrails you can audit"
        body={<>NeMo Guardrails on a Nebius job, recorded {MEASURED.date}. <Link href="/proof" className="inline-flex items-center gap-0.5 font-medium text-ink underline decoration-stone-300 underline-offset-[3px] hover:decoration-accent">See the proof<span className="size-3.5">{Icon.arrowUpRight}</span></Link></>}
      />
    </div>
  );
}
