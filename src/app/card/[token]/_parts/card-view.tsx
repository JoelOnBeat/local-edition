"use client";

import Link from "next/link";
import type { PublicStaffCard } from "@/contract";
import { Button, Lockup, SampleBadge, Skeleton, StoreTile, cx } from "@/components/ui";
import { Icon, type IconName } from "@/components/app-ui/icons";
import { useAsync } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";

/** The staff card on a phone: one store, this week, the few things to say and play. Guardrail details stay with head office. */

type Kind = "special" | "sound" | "partner" | "event" | "other";
const KIND: Record<Kind, { label: string; icon: IconName }> = {
  special: { label: "This week's special", icon: "cup" },
  sound: { label: "On the speakers", icon: "music" },
  partner: { label: "Partner nearby", icon: "handshake" },
  event: { label: "Event", icon: "ticket" },
  other: { label: "This week", icon: "file" },
};
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

function Line({ heading, body, lead }: { heading: string; body: string; lead: boolean }) {
  const kind = kindOf(heading);
  const [title, rest] = splitLead(body);
  const when = kind === "event" ? whenOf(`${heading} ${body}`) : null;
  const k = KIND[kind];
  return (
    <section data-testid="card-line" data-kind={kind} className="grid gap-2 border-t border-rule-subtle px-5 py-5 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-[14px] font-medium leading-5 text-ink-2">
          <Icon name={k.icon} className="shrink-0 text-faint" />
          <span className="truncate">{kind === "other" ? heading : k.label}</span>
        </h2>
        {when ? (
          <span
            data-testid="card-when"
            data-tonight={when.tonight}
            className={cx(
              "inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[12px] font-medium tnum",
              when.tonight ? "bg-accent text-accent-ink shadow-primary-sm" : "bg-white text-ink-strong shadow-ring-xs",
            )}
          >
            {when.tonight ? `Tonight, ${when.time}` : `${when.day} ${when.time}`}
          </span>
        ) : null}
      </div>
      {title ? (
        <p className={cx("font-medium tracking-[-0.025em] text-ink [overflow-wrap:anywhere]", lead ? "text-[24px] leading-8" : "text-[19px] leading-7 tracking-[-0.02em]")}>{title}</p>
      ) : null}
      <p className="text-[16px] leading-6 text-ink-2 [overflow-wrap:anywhere]">
        {kind === "special" && rest ? <span className="mr-1 font-medium text-ink">Say:</span> : null}
        {rest}
      </p>
    </section>
  );
}

function Shell({ children, top }: { children: React.ReactNode; top?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <main className="mx-auto w-full max-w-[420px] px-2 pb-10 pt-4 sm:pt-10">
        <div className="flex min-h-10 items-center justify-between gap-3 px-2 pb-3">
          <Lockup size="sm" />
          {top}
        </div>
        {children}
      </main>
    </div>
  );
}

const card = "ring-after relative overflow-hidden rounded-xl bg-white";

export function CardView({ token }: { token: string }) {
  const q = useAsync(`card:${token}`, () => getApi().getPublicCard(token));

  if (q.loading && !q.data) {
    return (
      <Shell>
        <div data-testid="card-loading" className={cx(card, "grid gap-6 px-5 py-6")} role="status" aria-label="Loading the staff card">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-3">
              <Skeleton className="h-3 w-32 rounded-full" />
              <Skeleton className={i === 0 ? "h-6 w-56" : "h-4 w-44"} />
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-2/3 rounded-full" />
            </div>
          ))}
        </div>
      </Shell>
    );
  }
  if (q.error || !q.data) {
    const gone = q.error?.status === 404;
    return (
      <Shell>
        <div data-testid={gone ? "card-not-live" : "card-error"} className={cx(card, "flex flex-col items-center px-6 py-14 text-center")}>
          <span className="flex size-10 items-center justify-center rounded-[10px] bg-well shadow-[inset_0_0_0_1px_var(--well-ring)]">
            <Icon name={gone ? "clock" : "alert"} size={20} className={gone ? "text-ink-2" : "text-flag"} />
          </span>
          <p className="mt-4 text-[16px] font-medium leading-6 text-ink">{gone ? "This card is not live" : "The card did not load"}</p>
          <p className="mt-1 max-w-[320px] text-[14px] leading-5 text-ink-2">
            {gone
              ? "Head office has not approved this week's card yet, or the link is from an older week. Ask your manager for the current link."
              : q.error?.message ?? "Something went wrong."}
          </p>
          {gone ? null : <Button data-testid="card-retry" size="sm" className="mt-5" onClick={q.reload}>Try again</Button>}
        </div>
      </Shell>
    );
  }

  const { card: staff, store, chainName }: PublicStaffCard = q.data;
  const sample = /\(sample chain\)/i.test(chainName);
  const chain = chainName.replace(/\s*\(sample chain\)/i, "");
  return (
    <Shell top={sample ? <SampleBadge /> : undefined}>
      <div className={card}>
        <header data-testid="card-header" data-store-id={store.id} className="flex items-center gap-3 border-b border-rule-subtle bg-paper-2 px-5 py-4">
          <StoreTile colorIndex={store.colorIndex} name={store.name} size="lg" className="size-10 rounded-[10px] text-[14px]" />
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-medium leading-7 tracking-[-0.02em] text-ink">{store.name}</h1>
            <p className="truncate text-[13px] leading-5 text-muted">{chain} · {store.addressLabel}</p>
          </div>
        </header>
        {staff.lines.length === 0 ? (
          <p className="px-5 py-10 text-center text-[16px] text-muted">Nothing on the card this week.</p>
        ) : (
          staff.lines.map((l, i) => <Line key={`${i}-${l.heading}`} heading={l.heading} body={l.body} lead={i === 0} />)
        )}
        <footer className="flex items-center gap-2 border-t border-rule-subtle bg-paper-2 px-5 py-3.5 text-[13px] leading-5 text-muted">
          <Icon name="check" size={14} className="shrink-0 text-ok-ink" />
          Approved by head office for this week
        </footer>
      </div>
      <p className="px-3 pt-5 text-[13px] leading-5 text-muted">
        Written for this block by Local Edition. Questions: reply to the card email or ask in your store channel.{" "}
        <Link href="/" className="font-medium text-ink-2 underline decoration-stone-300 underline-offset-[3px] hover:text-ink">About Local Edition</Link>
      </p>
    </Shell>
  );
}
