import type { Edition, EditionItem, Evidence } from "@/contract";
import { mockEditions, tagsFor } from "@/mocks";
import { SAMPLE_MENU, SAMPLE_STORES } from "@/server/sample/chain";
import { SectionHead } from "./landing-loop";

/** A real edition from the sample chain, set as the small front page head office sees. */

const STORE_ID = "store_williamsburg";

const SOURCE_LABEL: Record<Evidence["source"], string> = { qloo: "Qloo", tavily: "Tavily", tokenfactory: "Nemotron" };

function evidenceLine(edition: Edition, item: EditionItem): string {
  const ev = edition.evidence.find((e) => item.evidenceIds.includes(e.id) && e.source !== "tokenfactory") ?? edition.evidence[0];
  const m = ev.metrics;
  const metric =
    m.lift !== undefined ? `lift +${m.lift.toFixed(2)}` :
    m.distanceM !== undefined ? `${m.distanceM} m away` :
    m.affinity !== undefined ? `affinity ${m.affinity.toFixed(2)}` :
    m.relevance !== undefined ? `relevance ${m.relevance.toFixed(2)}` : "";
  return `${SOURCE_LABEL[ev.source]} ${ev.endpoint}${metric ? ` · ${metric}` : ""}`;
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-(--store-1)">{children}</span>;
}

function Proof({ text }: { text: string }) {
  return (
    <p className="mt-auto border-t border-dotted border-(--rule) pt-2 font-(family-name:--font-mono) text-[11.5px] text-(--muted)">
      {text}
    </p>
  );
}

export function LandingEdition() {
  const edition = mockEditions.find((e) => e.storeId === STORE_ID);
  const store = SAMPLE_STORES.find((s) => s.id === STORE_ID);
  if (!edition || !store) return null;
  const pick = <K extends EditionItem["kind"]>(k: K) => edition.items.find((i): i is Extract<EditionItem, { kind: K }> => i.kind === k);
  const special = pick("special");
  const sound = pick("sound");
  const partner = pick("partner");
  const event = pick("event");
  if (!special || !sound || !partner || !event) return null;
  const base = SAMPLE_MENU.find((m) => m.id === special.baseMenuItemId);
  const tags = tagsFor(STORE_ID).slice(0, 5);

  return (
    <section className="border-b border-(--rule) bg-(--paper-2)">
      <div className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6">
        <SectionHead
          kicker="A real edition from the sample chain"
          title="Williamsburg, issue 43."
          lede="This is what head office reads for one store. Every line carries the call that justified it, and a line with no evidence is dropped before anyone sees it."
        />

        <article className="mt-8 overflow-hidden rounded-(--radius) border border-(--rule) bg-(--paper) shadow-(--shadow)">
          <header className="border-b-4 border-(--store-1) px-5 pb-3 pt-5 sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-(family-name:--font-mono) text-[11.5px] uppercase tracking-[0.08em] text-(--muted)">
                Kettle &amp; Kiln (sample chain)
              </span>
              <span className="rounded-full border border-(--rule) px-2 py-0.5 text-[11.5px] font-semibold text-(--muted)">Sample data</span>
            </div>
            <h3 className="mt-1 font-(family-name:--font-display) text-[clamp(34px,5vw,54px)] font-extrabold leading-none tracking-[-0.03em]">
              The Williamsburg Edition
            </h3>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-(--ink) pt-2 font-(family-name:--font-mono) text-[12px] text-(--ink-2)">
              <span>No. {edition.issueNo}</span>
              <span>Week of Mon 26 Oct 2026</span>
              <span>{store.addressLabel}</span>
            </p>
          </header>

          <div className="grid gap-px bg-(--rule) lg:grid-cols-[1.35fr_1fr]">
            <div className="flex flex-col gap-3 bg-(--paper) p-5 sm:p-7">
              <Kicker>This week&apos;s special · from the {base?.name ?? "menu"}</Kicker>
              <h4 className="font-(family-name:--font-display) text-[clamp(28px,3.4vw,38px)] font-extrabold leading-[1.02] tracking-[-0.02em]">
                {special.name}
              </h4>
              <p className="text-[17px] leading-[1.55] text-(--ink-2)">{special.description}</p>
              <ul className="flex flex-wrap gap-1.5">
                {special.flavourTags.map((t) => (
                  <li key={t} className="rounded-full border border-(--rule) px-2 py-0.5 text-[12.5px]">{t}</li>
                ))}
              </ul>
              <blockquote className="border-l-2 border-(--store-1) pl-3 text-[15px] italic text-(--ink-2)">
                Staff line: {special.staffLine}
              </blockquote>
              <div className="mt-2 grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-(--muted)">The block, against New York</span>
                <ul className="grid gap-1">
                  {tags.map((t) => (
                    <li key={t.tagId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[13.5px]">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 rounded-full bg-(--store-1)" style={{ width: `${Math.round(t.lift * 160)}px` }} aria-hidden />
                        <span className="truncate">{t.name}</span>
                      </span>
                      <span className="font-(family-name:--font-mono) text-[12px] text-(--muted)">+{t.lift.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Proof text={evidenceLine(edition, special)} />
            </div>

            <div className="grid gap-px bg-(--rule)">
              <div className="flex flex-col gap-2 bg-(--paper) p-5">
                <Kicker>On the speakers</Kicker>
                <p className="font-(family-name:--font-display) text-[19px] font-bold leading-snug">{sound.mood}</p>
                <p className="text-[14.5px] leading-[1.5] text-(--ink-2)">{sound.brief}</p>
                <p className="text-[13.5px] text-(--muted)">{sound.artists.slice(0, 5).map((a) => a.name).join(" · ")}</p>
                <Proof text={evidenceLine(edition, sound)} />
              </div>
              <div className="flex flex-col gap-2 bg-(--paper) p-5">
                <Kicker>Next door · {partner.place.distanceM} m</Kicker>
                <p className="font-(family-name:--font-display) text-[19px] font-bold leading-snug">{partner.place.name}</p>
                <p className="text-[14.5px] leading-[1.5] text-(--ink-2)">{partner.offerIdea}</p>
                <Proof text={evidenceLine(edition, partner)} />
              </div>
              <div className="flex flex-col gap-2 bg-(--paper) p-5">
                <Kicker>{event.day} {event.time}</Kicker>
                <p className="font-(family-name:--font-display) text-[19px] font-bold leading-snug">{event.title}</p>
                <p className="text-[14.5px] leading-[1.5] text-(--ink-2)">{event.description}</p>
                <Proof text={evidenceLine(edition, event)} />
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
