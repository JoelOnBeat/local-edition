"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Pill, cx } from "../ui";
import { Band, FrameCard, Gap, Page, PageHeader } from "../app-ui/frame";
import { Icon } from "../app-ui/icons";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "How do I build this week's editions?",
    a: <>On the <Link href="/app">portfolio</Link>, press “Build this week&rsquo;s editions”. The run view streams each store&rsquo;s tool calls, models and cost; the editions land on the portfolio when it finishes.</>,
  },
  {
    q: "Why can't I approve an item?",
    a: "Flagged or blocked copy is never approved, alone or in bulk: edit it or regenerate it first. Copy the guardrails have not checked yet can be approved only by hand, with “Approve anyway”.",
  },
  {
    q: "What does “Certified” mean on an item?",
    a: <>NeMo Guardrails checked it in a Nebius job, started on demand. Every other line was checked live: a rule mirror plus a Nemotron self-check. The latest results are on <Link href="/app/proof">Proof</Link>.</>,
  },
  {
    q: "Where does the evidence come from?",
    a: "Each item lists the Qloo and Tavily calls it rests on, with the numbers that mattered. Open “Why this?” on any item. An item without evidence is dropped before you see it.",
  },
  {
    q: "What is the reviewer's note?",
    a: "After every store is drafted, Nemotron 3 Ultra reads the whole chain side by side and asks for a change when two stores repeat each other. Its note sits on each edition.",
  },
  {
    q: "How do store managers reply?",
    a: <>With Gmail or Outlook connected, replies to the staff card email are filed on the edition under “From the store”, and a change request becomes a suggestion you can accept. Connect a mailbox in <Link href="/app/connections">Connections</Link>.</>,
  },
  {
    q: "Does it cost anything?",
    a: <>No. There is no plan and no payment. Model spend, Qloo and Tavily calls each have a hard cap, listed on <Link href="/app/limits">Limits</Link>.</>,
  },
  {
    q: "Is Kettle & Kiln a real chain?",
    a: "No. It is a sample chain: its stores sit on real New York corners, but the chain, its partners and its events are made up. Create an account to keep your copy and connect your own tools.",
  },
  {
    q: "How do I delete my data?",
    a: <>Open <Link href="/app/settings#account">Chain settings</Link>, then Account. Deleting asks for your password again and removes the chain, its editions and its connections.</>,
  },
];

/** /app/help: short answers in the product's own words, as ByDefault's FAQ accordion. */
export function HelpView() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Page>
      <PageHeader pill={<Pill icon={<Icon name="info" />}>Help</Pill>} title="Questions head office asks" lede="Short answers. The steps behind them are on How it works." />
      <Gap />
      <Band grow>
        <FrameCard className="mx-auto w-full max-w-[800px] [--ring:var(--rule)]">
          <ul>
            {QA.map((item, i) => {
              const on = open === i;
              return (
                <li key={item.q} className={cx("border-b border-rule-subtle px-5 transition-colors duration-150 last:border-b-0 sm:px-7", on ? "bg-stone-50" : "hover:bg-stone-50/60", i === 0 && "rounded-t-xl", i === QA.length - 1 && "rounded-b-xl")}>
                  <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : i)} className="group flex w-full items-center justify-between gap-6 py-5 text-left text-[16px] font-medium leading-6 text-ink">
                    {item.q}
                    <span className={cx("relative size-3.5 shrink-0 transition-colors", on ? "text-stone-600" : "text-faint group-hover:text-ink")} aria-hidden>
                      <span className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 rounded-full bg-current" />
                      <span className={cx("absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 rounded-full bg-current transition-opacity duration-200", on && "opacity-0")} />
                    </span>
                  </button>
                  <div className="le-fold" data-open={on}>
                    <div>
                      <p className="max-w-[620px] pb-6 text-[16px] leading-[26px] text-ink-2 [&_a]:font-medium [&_a]:text-ink [&_a]:underline [&_a]:decoration-stone-300 [&_a]:underline-offset-[3px]">{item.a}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </FrameCard>
        <p className="mx-auto mt-6 flex w-full max-w-[800px] flex-wrap items-center gap-3 text-[14px] text-ink-2">
          Still unsure how a step works?
          <Link href="/app/how-it-works" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[14px] font-medium text-stone-800 shadow-ring-xs transition-colors hover:bg-stone-50">
            Read how it works
          </Link>
        </p>
      </Band>
    </Page>
  );
}
