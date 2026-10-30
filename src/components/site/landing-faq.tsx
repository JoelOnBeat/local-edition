"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass, cx } from "@/components/ui";
import { FAQ } from "./landing-data";
import { Container, Icon, SectionHeader } from "./section";

function Plus({ open }: { open: boolean }) {
  return (
    <span className="relative size-3.5 shrink-0 text-faint transition-colors duration-150 group-hover/faq:text-ink" aria-hidden>
      <span className={cx("absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 rounded-full bg-current", open && "text-stone-600")} />
      <span className={cx("absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 rounded-full bg-current transition-[transform,opacity] duration-200 ease-quint", open ? "rotate-90 opacity-0" : "")} />
    </span>
  );
}

export function LandingFaq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative scroll-mt-16 py-20 md:py-28" aria-labelledby="faq-title">
      <Container className="px-4 sm:px-6">
        <SectionHeader id="faq-title" pill="FAQ" pillIcon={Icon.help} title="Questions head office asks." lede="About the taste data, the guardrails, the sample chain and what is connected." />
        <div className="ring-after ring-rule mx-auto mt-14 max-w-[800px] overflow-hidden rounded-xl bg-white">
          {FAQ.map((f, i) => {
            const on = open === i;
            return (
              <div key={f.q} className={cx("border-b border-rule-subtle transition-colors duration-150 last:border-0", on ? "bg-stone-50" : "hover:bg-stone-50/60")}>
                <h3>
                  <button
                    type="button" aria-expanded={on} aria-controls={`faq-${i}`} id={`faq-q-${i}`}
                    onClick={() => setOpen(on ? null : i)}
                    className="group/faq flex w-full items-center justify-between gap-6 px-5 py-5 text-left text-[16px] font-medium leading-6 text-ink sm:px-7"
                  >
                    {f.q}
                    <Plus open={on} />
                  </button>
                </h3>
                <div
                  id={`faq-${i}`} role="region" aria-labelledby={`faq-q-${i}`}
                  className={cx("grid transition-[grid-template-rows] ease-quint", on ? "grid-rows-[1fr] duration-[220ms]" : "grid-rows-[0fr] duration-[180ms]")}
                >
                  <div className="overflow-hidden">
                    <div className="grid max-w-[620px] gap-3 px-5 pb-6 text-[16px] leading-[26px] text-ink-2 sm:px-7">
                      {f.a.map((p) => <p key={p}>{p}</p>)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-8 flex flex-wrap items-center justify-center gap-3 text-[16px] text-ink-2">
          Still have questions?
          <Link href="/limits" className={buttonClass("secondary", "sm")}>Read the limits</Link>
        </p>
      </Container>
    </section>
  );
}
