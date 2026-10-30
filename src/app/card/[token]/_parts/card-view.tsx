"use client";

import Link from "next/link";
import type { PublicStaffCard } from "@/contract";
import { Button, Skeleton, storeColor } from "@/components/ui";
import { useAsync } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";

/** The staff card on a phone: one store, this week, the few things to say and play. Guardrail details stay with head office. */

type Kind = "special" | "sound" | "partner" | "event" | "other";
const KIND_LABEL: Record<Kind, string> = { special: "This week's special", sound: "On the speakers", partner: "Send them next door", event: "Event night", other: "This week" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\.?,?\s+(?:at\s+)?(\d{1,2}:\d{2})/;

function kindOf(heading: string): Kind {
  const h = heading.toLowerCase();
  if (/special|menu|cup|try/.test(h)) return "special";
  if (/speaker|sound|music|play/.test(h)) return "sound";
  if (/next door|neighbo|partner/.test(h)) return "partner";
  if (/event|night|tonight/.test(h) || DAY_RE.test(heading)) return "event";
  return "other";
}

/** "Orange Peel Cortado. If someone asks…" -> ["Orange Peel Cortado", "If someone asks…"]. */
function splitLead(body: string): [string, string] {
  const i = body.search(/\.\s/);
  if (i <= 0 || i > 70) return ["", body];
  return [body.slice(0, i), body.slice(i + 2)];
}

function whenOf(text: string): { day: string; time: string; tonight: boolean } | null {
  const m = DAY_RE.exec(text);
  if (!m) return null;
  const today = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  return { day: m[1], time: m[2], tonight: DAYS.includes(m[1]) && today.startsWith(m[1]) };
}

function Line({ heading, body, color, lead }: { heading: string; body: string; color: string; lead: boolean }) {
  const kind = kindOf(heading);
  const [title, rest] = splitLead(body);
  const when = kind === "event" ? whenOf(`${heading} ${body}`) : null;
  return (
    <section data-testid="card-line" data-kind={kind} className="grid gap-1.5 border-t border-rule py-5 first:border-t-0 first:pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.12em]" style={{ color }}>{kind === "other" ? heading : KIND_LABEL[kind]}</h2>
        {when ? (
          <span data-testid="card-when" data-tonight={when.tonight} className="rounded-full px-2.5 py-0.5 font-mono text-[12px] font-semibold"
            style={when.tonight ? { background: color, color: "var(--paper)" } : { boxShadow: `inset 0 0 0 1px ${color}`, color }}>
            {when.tonight ? `Tonight, ${when.time}` : `${when.day} ${when.time}`}
          </span>
        ) : null}
      </div>
      {title ? (
        <p className={lead ? "font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.02em]" : "font-display text-[20px] font-bold leading-snug"}>{title}</p>
      ) : null}
      <p className={lead ? "text-[18px] leading-[1.5] text-ink" : "text-[16px] leading-[1.55] text-ink-2"}>
        {kind === "special" && rest ? <span className="mr-1 font-semibold text-ink">Say:</span> : null}
        {rest}
      </p>
    </section>
  );
}

function Frame({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="flex min-h-dvh justify-center bg-paper-2 sm:py-8">
      <main className="w-full max-w-[460px] bg-paper sm:rounded-[12px] sm:border sm:border-rule sm:shadow-[var(--shadow)]" style={color ? { borderTop: `8px solid ${color}` } : undefined}>
        {children}
      </main>
    </div>
  );
}

export function CardView({ token }: { token: string }) {
  const q = useAsync(`card:${token}`, () => getApi().getPublicCard(token));

  if (q.loading && !q.data) {
    return (
      <Frame>
        <div data-testid="card-loading" className="grid gap-4 p-6" role="status" aria-label="Loading the staff card">
          <Skeleton className="h-3 w-40" /><Skeleton className="h-10 w-56" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
        </div>
      </Frame>
    );
  }
  if (q.error || !q.data) {
    const gone = q.error?.status === 404;
    return (
      <Frame>
        <div data-testid={gone ? "card-not-live" : "card-error"} className="grid gap-3 p-6">
          <p className="font-display text-[26px] font-extrabold leading-tight">{gone ? "This card is not live" : "The card did not load"}</p>
          <p className="text-[16px] leading-[1.55] text-ink-2">
            {gone
              ? "Head office has not approved this week's card yet, or the link is from an older week. Ask your manager for the current link."
              : q.error?.message ?? "Something went wrong."}
          </p>
          {gone ? null : <Button data-testid="card-retry" onClick={q.reload} className="justify-self-start">Try again</Button>}
        </div>
      </Frame>
    );
  }

  const { card, store, chainName }: PublicStaffCard = q.data;
  const color = storeColor(store.colorIndex);
  const sample = /\(sample chain\)/i.test(chainName);
  return (
    <Frame color={color}>
      <header data-testid="card-header" data-store-id={store.id} className="grid gap-1 px-6 pb-3 pt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted">{chainName.replace(/\s*\(sample chain\)/i, "")} · Staff card</p>
          {sample ? <span className="shrink-0 rounded-full border border-rule px-2 py-0.5 text-[11px] font-semibold text-muted">Sample</span> : null}
        </div>
        <h1 className="font-display text-[40px] font-extrabold leading-none tracking-[-0.03em]">{store.name}</h1>
        <p className="border-b-2 border-ink pb-3 font-mono text-[12.5px] text-ink-2">{store.addressLabel}</p>
      </header>
      <div className="px-6">
        {card.lines.length === 0 ? (
          <p className="py-6 text-[16px] text-muted">Nothing on the card this week.</p>
        ) : (
          card.lines.map((l, i) => <Line key={`${i}-${l.heading}`} heading={l.heading} body={l.body} color={color} lead={i === 0} />)
        )}
      </div>
      <footer className="mt-2 border-t border-rule px-6 py-4 text-[12.5px] leading-[1.5] text-muted">
        Written for this block by Local Edition and approved by head office. Questions: reply to the card email or ask in your store channel.
        <Link href="/" className="mt-1 block font-semibold text-ink-2 underline underline-offset-4">About Local Edition</Link>
      </footer>
    </Frame>
  );
}
