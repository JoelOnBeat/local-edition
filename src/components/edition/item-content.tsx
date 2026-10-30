import type { EditionItem, EventItem, MenuItem, PartnerItem, SoundItem, SpecialItem } from "@/contract";
import { Chip } from "../ui";
import { formatDate, formatMeters } from "../lib/format";

const DAY: Record<EventItem["day"], string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

export const KICKER: Record<EditionItem["kind"], string> = {
  special: "This week's special",
  sound: "On the speakers",
  partner: "Next door",
  event: "Event night",
};

export function itemHeadline(item: EditionItem): string {
  switch (item.kind) {
    case "special": return item.name;
    case "sound": return item.mood;
    case "partner": return item.place.name;
    case "event": return item.title;
  }
}

export function SpecialContent({ item, base }: { item: SpecialItem; base?: MenuItem }) {
  return (
    <div>
      <h2 className="font-display text-[30px] font-bold leading-[1.02] tracking-[-0.015em] text-ink [overflow-wrap:anywhere] sm:text-[40px]">{item.name}</h2>
      <p className="mt-3 max-w-[60ch] text-[17px] leading-relaxed text-ink-2">{item.description}</p>
      {item.flavourTags.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {item.flavourTags.map((t) => <Chip key={t}>{t}</Chip>)}
        </div>
      ) : null}
      <blockquote className="mt-5 border-l-2 border-ink pl-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Say it like this</p>
        <p className="mt-1 text-[15px] italic leading-relaxed text-ink">“{item.staffLine}”</p>
      </blockquote>
      {base ? (
        <p className="mt-4 text-[13px] text-muted">
          Adapted from the menu: <span className="text-ink-2">{base.name}</span>
          {base.price !== null ? <span className="font-mono"> · ${base.price.toFixed(2)}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export function SoundContent({ item }: { item: SoundItem }) {
  return (
    <div>
      <h3 className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink [overflow-wrap:anywhere]">{item.mood}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{item.brief}</p>
      <ol className="mt-4 grid grid-cols-1 gap-x-4 text-[13.5px] text-ink sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {item.artists.map((a, i) => (
          <li key={a.entityId} className="flex min-w-0 items-baseline gap-2 border-b border-rule py-1.5">
            <span className="w-5 shrink-0 font-mono text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</span>
            <span className="truncate">{a.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PartnerContent({ item }: { item: PartnerItem }) {
  return (
    <div>
      <h3 className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink [overflow-wrap:anywhere]">{item.place.name}</h3>
      <p className="mt-1 text-[13px] text-muted">
        {item.place.address ?? "Address not listed"} · <span className="font-mono text-ink-2">{formatMeters(item.place.distanceM)}</span> away
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{item.reason}</p>
      <div className="mt-4 rounded-[var(--radius)] bg-paper-2 px-3.5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">The offer</p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink">{item.offerIdea}</p>
      </div>
    </div>
  );
}

export function EventContent({ item }: { item: EventItem }) {
  return (
    <div>
      <p className="font-mono text-[13px] text-ink-2">
        {DAY[item.day]} <span className="text-ink">{item.time}</span>
      </p>
      <h3 className="mt-1 font-display text-[22px] font-semibold leading-tight tracking-tight text-ink [overflow-wrap:anywhere]">{item.title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{item.description}</p>
      {item.tieIn ? (
        <div className="mt-4 border-t border-rule pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Tied to a local listing {item.tieIn.triage && !item.tieIn.triage.kept ? "· set aside" : ""}
          </p>
          <a href={item.tieIn.url} target="_blank" rel="noreferrer" className="mt-1 block text-[14px] font-medium text-ink underline decoration-rule underline-offset-4 hover:decoration-ink [overflow-wrap:anywhere]">
            {item.tieIn.title}
          </a>
          <p className="mt-1 text-[12.5px] text-muted">
            {[item.tieIn.venue, item.tieIn.date ? formatDate(item.tieIn.date) : null].filter(Boolean).join(" · ")}
          </p>
          {item.tieIn.triage ? <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{item.tieIn.triage.reason}</p> : null}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-muted">No nearby listing matched this week; the night stands on the block&apos;s taste alone.</p>
      )}
    </div>
  );
}
