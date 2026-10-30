"use client";

import { cx } from "../ui";
import { Icon } from "../app-ui/icons";
import { formatMs } from "../lib/format";
import type { StepView } from "./run-steps";
import { usd } from "./trace-entry";

/**
 * The left tablist of the dark panel (the design system's how-it-works stepper): one row per pipeline step. The expanded row shows
 * what the step does, its calls, model time and cost, and a 2px flame bar that tracks the step's answered calls.
 */
export function StepTabs({ steps, expanded, selected, onSelect }: {
  steps: StepView[];
  expanded: number | null;
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  return (
    <div role="tablist" aria-label="Pipeline steps" aria-orientation="vertical" className="flex flex-col">
      {steps.map((s) => {
        const open = expanded === s.index;
        const ratio = s.state === "done" ? 1 : s.calls ? s.answered / s.calls : s.entries.length ? 0.5 : 0;
        return (
          <button
            key={s.def.id}
            type="button"
            role="tab"
            aria-selected={selected === s.index}
            data-step={s.def.id}
            data-state={s.state}
            onClick={() => onSelect(s.index)}
            className={cx(
              "relative flex min-h-[64px] w-full flex-col justify-center border-b border-band-rule px-5 text-left transition-colors duration-300 last:border-b-0 lg:min-h-[68px] lg:px-6",
              open ? "bg-white/[.02] py-5" : "py-3.5 hover:bg-white/[.02]",
            )}
          >
            <span className="flex items-center gap-3">
              <span
                className={cx(
                  "w-7 shrink-0 text-[18px] font-medium leading-6 tnum",
                  s.state === "active" || open ? "text-accent-dark" : s.state === "done" ? "text-band-own" : s.state === "failed" ? "text-[#FF6467]" : "text-band-ink-3",
                )}
              >
                {s.state === "done" && !open ? <Icon name="check" size={18} strokeWidth={2.4} /> : String(s.index + 1).padStart(2, "0")}
              </span>
              <span className={cx("min-w-0 flex-1 truncate text-[18px] font-medium leading-6 tracking-[-0.01em] transition-colors duration-300", open || s.state === "active" ? "text-band-ink" : s.state === "done" ? "text-band-ink-2" : "text-band-ink-3")}>
                {s.def.title}
              </span>
              {s.state === "active" ? <span className="le-live-dot size-1.5 shrink-0 rounded-full bg-accent" aria-label="Working" /> : null}
              {s.state === "ready" ? <span className="shrink-0 rounded-md bg-white/[.06] px-1.5 py-0.5 text-[11px] font-medium text-band-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.09)]">Ready</span> : null}
              {!open && s.entries.length ? <span className="shrink-0 font-mono text-[12px] text-band-ink-3 tnum">{s.calls || s.entries.length}</span> : null}
            </span>
            <span className="le-fold" data-open={open}>
              <span className="block">
                <span className="block pl-10 pt-2 text-[15px] leading-6 text-band-ink-2 lg:text-[16px]">{s.def.body}</span>
                <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 pl-10 font-mono text-[12px] text-band-ink-3 tnum">
                  {s.calls ? <span>{s.answered}/{s.calls} calls</span> : null}
                  {s.ms ? <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} />{formatMs(s.ms)}</span> : null}
                  {s.usd ? <span>{usd(s.usd)}</span> : null}
                  {!s.entries.length ? <span>{s.state === "ready" ? "waiting for head office" : "no calls yet"}</span> : null}
                </span>
              </span>
            </span>
            {open ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/[.04]" aria-hidden>
                <span className="block h-full origin-left bg-accent transition-transform duration-500 ease-quint" style={{ transform: `scaleX(${ratio})` }} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
