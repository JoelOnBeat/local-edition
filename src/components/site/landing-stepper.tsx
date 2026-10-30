"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

export interface Step {
  title: string;
  body: string;
  pane: ReactNode;
}

const STEP_MS = 7000;

/**
 * The dark how-it-works panel: a tablist of four steps on the left (the active one grows, shows its body and a 2px flame
 * progress bar), the matching mock on the right. Advances every 7 s; a click picks a step; reduced motion stops the timer.
 */
export function Stepper({ steps }: { steps: Step[] }) {
  const [active, setActive] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setStill(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const pick = (i: number) => { setActive(i); setCycle((c) => c + 1); };
  const next = () => pick((active + 1) % steps.length);

  return (
    <div className="rounded-[22px] bg-band p-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]">
      <div className="grid overflow-hidden rounded-2xl bg-band-panel shadow-[0_0_0_1px_rgb(255_255_255/.06)] lg:grid-cols-[340px_minmax(0,1fr)]">
        <div role="tablist" aria-label="How it works" className="order-2 border-t border-band-rule lg:order-1 lg:border-r lg:border-t-0">
          {steps.map((s, i) => {
            const on = i === active;
            return (
              <button
                key={s.title} type="button" role="tab" aria-selected={on} aria-controls={`step-pane-${i}`} id={`step-tab-${i}`}
                onClick={() => pick(i)}
                className={cx(
                  "relative flex w-full flex-col border-b border-band-rule px-7 text-left transition-[padding] duration-500 ease-quint last:border-b-0",
                  on ? "py-6 lg:min-h-[214px]" : "py-5 hover:bg-white/[.02]",
                )}
              >
                <span className="flex items-baseline gap-3 text-[18px] font-medium leading-6 tracking-[-0.01em]">
                  <span className={cx("tnum transition-colors duration-300", on ? "text-accent-dark" : "text-band-ink-3")}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={cx("transition-colors duration-300", on ? "text-band-ink" : "text-band-ink-2")}>{s.title}</span>
                </span>
                <span className={cx("grid transition-[grid-template-rows,opacity] duration-500 ease-quint", on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                  <span className="overflow-hidden">
                    <span className="block pl-[34px] pt-3 text-[16px] leading-6 text-band-ink-2">{s.body}</span>
                  </span>
                </span>
                {on ? (
                  <span aria-hidden className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-white/[.04]">
                    <span
                      key={cycle}
                      className="block h-full origin-left bg-accent"
                      style={still ? { transform: "scaleX(1)" } : { animation: `le-progress ${STEP_MS}ms linear both` }}
                      onAnimationEnd={next}
                    />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="order-1 min-h-[420px] bg-band-inner p-4 sm:p-6 lg:order-2 lg:min-h-[470px]">
          {steps.map((s, i) => (
            <div key={s.title} role="tabpanel" id={`step-pane-${i}`} aria-labelledby={`step-tab-${i}`} hidden={i !== active} className={i === active ? "le-enter h-full" : undefined}>
              {s.pane}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
