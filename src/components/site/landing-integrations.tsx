import Link from "next/link";
import { SectionHead } from "./landing-loop";

/** "Connects to what you already use" and "Built on": what each tool does, in one line, and where it shows. */

const CONNECTS = [
  {
    name: "Square",
    mark: "Sq",
    what: "Menu and locations in. The approved special out, as a new item on each store's menu. Menu changes sync back as they happen.",
  },
  {
    name: "Slack",
    mark: "Sl",
    what: "Each staff card is posted to the store's channel. Head office gets Approve and Edit buttons right in the thread.",
  },
  {
    name: "Gmail",
    mark: "Gm",
    what: "Staff cards are emailed from head office's own mailbox. When a store replies, the reply shows up on that store's edition.",
  },
  {
    name: "Outlook",
    mark: "Ol",
    what: "The same delivery and replies for chains on Microsoft 365, from the head-office address stores already know.",
  },
  {
    name: "Google and Outlook Calendar",
    mark: "Ca",
    what: "A calendar feed of every store's event nights. Subscribe once and next week's events appear on their own.",
  },
];

const BUILT_ON = [
  {
    name: "Qloo Taste AI",
    what: "What each store's block likes compared with the city: flavours, artists, places nearby. The reason behind every item.",
  },
  {
    name: "NVIDIA Nemotron on Nebius Token Factory",
    what: "Nemotron 3.5 Super VL runs the agent and reads menu photos, Lightning writes the copy and Nemotron 3 Ultra reviews the chain.",
  },
  {
    name: "NeMo Guardrails",
    what: "Checks every line for health claims and brand voice. Changes are shown to head office, never hidden.",
  },
  {
    name: "Tavily",
    what: "Finds what is on near each store that week, so an event night can tie in with the neighbourhood.",
  },
  {
    name: "Cloudflare",
    what: "Hosts the app, keeps each workspace's data, caches every Qloo answer and runs the weekly build step by step.",
  },
];

export function LandingIntegrations() {
  return (
    <>
      <section id="connects" className="scroll-mt-16 border-b border-(--rule)">
        <div className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6">
          <SectionHead
            kicker="Connects to what you already use"
            title="No spreadsheets to move. The edition goes where your stores already look."
          />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTS.map((c) => (
              <li key={c.name} className="flex gap-4 rounded-(--radius) border border-(--rule) bg-(--paper) p-4">
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-(--paper-2) font-(family-name:--font-mono) text-[13px] font-semibold text-(--ink-2) ring-1 ring-(--rule)"
                >
                  {c.mark}
                </span>
                <div className="grid gap-1">
                  <h3 className="text-[16px] font-semibold">{c.name}</h3>
                  <p className="text-[14.5px] leading-[1.5] text-(--ink-2)">{c.what}</p>
                </div>
              </li>
            ))}
            <li className="flex flex-col justify-center gap-2 rounded-(--radius) border border-dashed border-(--rule) p-4 text-[14.5px] text-(--muted)">
              <p>Every move between Local Edition and these tools is logged, in or out, with the store it touched.</p>
              <Link href="/app/connections" className="font-semibold text-(--ink) underline underline-offset-4">
                See the sample chain&apos;s sync log
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <section id="built-on" className="scroll-mt-16 border-b border-(--rule)">
        <div className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6">
          <SectionHead kicker="Built on" title="Each part does real work you can trace." />
          <dl className="mt-8 grid border-t border-(--ink)">
            {BUILT_ON.map((b) => (
              <div key={b.name} className="grid gap-1 border-b border-(--rule) py-4 md:grid-cols-[minmax(0,22rem)_1fr] md:gap-8">
                <dt className="font-(family-name:--font-display) text-[19px] font-bold leading-snug">{b.name}</dt>
                <dd className="text-[15.5px] leading-[1.55] text-(--ink-2)">{b.what}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-[14.5px] text-(--muted)">
            Which model did which step, the guardrail test results and the latest Nebius job runs are on{" "}
            <Link href="/proof" className="font-semibold text-(--ink) underline underline-offset-4">the proof page</Link>. What it
            cannot do yet is on{" "}
            <Link href="/limits" className="font-semibold text-(--ink) underline underline-offset-4">the limits page</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
