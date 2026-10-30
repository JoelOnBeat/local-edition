import type { BlockTag, EditionItem, EventItem, MenuItem, PartnerItem, SoundItem, SpecialItem } from "@/contract";
import { Chip } from "../ui";
import { Icon, type IconName } from "../app-ui/icons";
import { LogoTile } from "../app-ui/tiles";
import { ScorePill, signed } from "../app-ui/status";
import { formatDate, formatMeters } from "../lib/format";

const DAY: Record<EventItem["day"], string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

export const KICKER: Record<EditionItem["kind"], string> = {
  special: "This week's special",
  sound: "On the speakers",
  partner: "Next door",
  event: "Event night",
};

export const ITEM_ICON: Record<EditionItem["kind"], IconName> = { special: "cup", sound: "music", partner: "handshake", event: "ticket" };

export function itemHeadline(item: EditionItem): string {
  switch (item.kind) {
    case "special": return item.name;
    case "sound": return item.mood;
    case "partner": return item.place.name;
    case "event": return item.title;
  }
}

/** The main body copy of an item (what guardrails usually rewrite). */
export function itemCopy(item: EditionItem): string {
  switch (item.kind) {
    case "special": return item.description;
    case "sound": return item.brief;
    case "partner": return item.reason;
    case "event": return item.description;
  }
}

const title = "text-[19px] font-medium leading-7 tracking-[-0.02em] text-ink [overflow-wrap:anywhere]";
const copy = "mt-2 max-w-[64ch] text-[16px] leading-[26px] text-ink-2 [overflow-wrap:anywhere]";

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-medium leading-5 text-muted">{children}</p>;
}

/** Flavour tags as pills; a tag that is also one of the block's Qloo tags carries its lift in mono. */
function TastePills({ tags, profile }: { tags: string[]; profile?: BlockTag[] }) {
  if (!tags.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const q = profile?.find((p) => p.name.toLowerCase() === t.toLowerCase());
        return <ScorePill key={t} score={q ? signed(q.lift) : undefined} title={q ? `Qloo lift over the city ${signed(q.lift)}` : undefined}>{t}</ScorePill>;
      })}
    </div>
  );
}

export function SpecialContent({ item, base, profile }: { item: SpecialItem; base?: MenuItem; profile?: BlockTag[] }) {
  return (
    <div>
      <h3 className={title}>{item.name}</h3>
      <p className={copy}>{item.description}</p>
      <TastePills tags={item.flavourTags} profile={profile} />
      <figure className="mt-4 rounded-lg bg-paper-2 px-4 py-3 shadow-[inset_0_0_0_1px_var(--rule-subtle)]">
        <figcaption className="flex items-center gap-1.5 text-[13px] font-medium text-muted"><Icon name="quote" size={13} className="text-faint" />Say it like this</figcaption>
        <blockquote className="mt-1 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">“{item.staffLine}”</blockquote>
      </figure>
      {base ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          {base.source === "square" ? <LogoTile provider="square" size="xs" /> : <Icon name="list" size={14} className="text-faint" />}
          Adapted from the menu: <span className="font-medium text-ink-2">{base.name}</span>
          {base.price !== null ? <span className="font-mono text-[12px] text-ink-2">${base.price.toFixed(2)}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export function SoundContent({ item }: { item: SoundItem }) {
  return (
    <div>
      <h3 className={title}>{item.mood}</h3>
      <p className={copy}>{item.brief}</p>
      <ol className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {item.artists.map((a, i) => (
          <li key={a.entityId} className="flex min-w-0 items-center gap-3 border-b border-rule-row py-2 text-[14px] font-medium text-ink-strong">
            <span className="w-5 shrink-0 text-[12px] font-medium text-ink-2 tnum">{i + 1}</span>
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
      <h3 className={title}>{item.place.name}</h3>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <Icon name="pin" size={13} className="text-faint" />
        <span className="[overflow-wrap:anywhere]">{item.place.address ?? "Address not listed"}</span>
        <span className="font-mono text-[12px] text-ink-2">{formatMeters(item.place.distanceM)}</span>
      </p>
      <p className={copy}>{item.reason}</p>
      <div className="mt-4 rounded-lg bg-paper-2 px-4 py-3 shadow-[inset_0_0_0_1px_var(--rule-subtle)]">
        <Label>The offer</Label>
        <p className="mt-1 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{item.offerIdea}</p>
      </div>
    </div>
  );
}

export function EventContent({ item }: { item: EventItem }) {
  const t = item.tieIn;
  return (
    <div>
      <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-white px-2 text-[12px] font-medium text-ink-strong shadow-ring-xs">
        <Icon name="calendar" size={12} className="text-faint" />
        {DAY[item.day]} <span className="font-mono">{item.time}</span>
      </span>
      <h3 className={`mt-2.5 ${title}`}>{item.title}</h3>
      <p className={copy}>{item.description}</p>
      {t ? (
        <div className="mt-4 rounded-lg bg-paper-2 px-4 py-3 shadow-[inset_0_0_0_1px_var(--rule-subtle)]">
          <div className="flex flex-wrap items-center gap-2">
            <LogoTile provider="tavily" size="xs" />
            <Label>Tied to a local listing</Label>
            {t.triage && !t.triage.kept ? <Chip tone="warn">Set aside</Chip> : null}
          </div>
          <a href={t.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex max-w-full items-start gap-1 text-[14px] font-medium text-ink underline decoration-stone-300 underline-offset-[3px] hover:decoration-ink [overflow-wrap:anywhere]">
            {t.title}
            <Icon name="arrowUpRight" size={14} className="mt-0.5 shrink-0 text-faint" />
          </a>
          {t.venue || t.date ? <p className="mt-0.5 text-[13px] text-muted">{[t.venue, t.date ? formatDate(t.date) : null].filter(Boolean).join(" · ")}</p> : null}
          {t.triage ? <p className="mt-2 text-[14px] leading-[22px] text-ink-2">{t.triage.reason}</p> : null}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-muted">No nearby listing matched this week; the night stands on the block&apos;s taste alone.</p>
      )}
    </div>
  );
}
