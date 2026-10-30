"use client";

import type { Weekday } from "@/contract";
import { cx } from "../ui";
import { Icon } from "../app-ui/icons";
import { Dropdown, MenuItem, MenuLabel } from "../app-ui/menu";

const DAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Half-hour slots from 07:00 to 23:30, the hours a café runs an event night. */
const SLOTS = Array.from({ length: 34 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** Day as a segmented control (sliding white thumb on a stone track), time as a designed list of half-hour slots. */
export function DayTimeFields({ day, time, onDay, onTime }: { day: string; time: string; onDay: (d: Weekday) => void; onTime: (t: string) => void }) {
  const slots = SLOTS.includes(time) ? SLOTS : [...SLOTS, time].sort();
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="grid min-w-0 gap-2">
        <span className="text-[14px] font-medium leading-5 text-ink">Day</span>
        <div role="radiogroup" aria-label="Day" data-testid="edit-field-day" className="grid h-10 grid-cols-7 rounded-full bg-neutral-200/50 p-1">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={d === day}
              onClick={() => onDay(d)}
              className={cx(
                "rounded-full text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-quint",
                d === day ? "bg-white text-[#151515] shadow-[var(--shadow-ring-sm)] [--ring:rgb(0_0_0/.12)]" : "text-[#797979] hover:text-ink",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <span className="text-[14px] font-medium leading-5 text-ink">Time</span>
        <Dropdown
          label="Time"
          align="end"
          width="w-40"
          testId="edit-field-time"
          triggerClassName="flex h-10 w-full items-center gap-2 rounded-lg bg-white pl-3 pr-2.5 text-[14px] text-ink shadow-[inset_0_0_0_1px_#E5E5E5] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--rule-strong)] sm:w-32"
          trigger={() => (
            <>
              <Icon name="clock" size={14} className="text-faint" />
              <span className="flex-1 text-left font-mono">{time}</span>
              <Icon name="chevronDown" size={14} className="text-faint" />
            </>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Starts at</MenuLabel>
              <div className="max-h-64 overflow-y-auto">
                {slots.map((t) => (
                  <MenuItem key={t} active={t === time} className="py-1.5 font-mono" onClick={() => { onTime(t); close(); }}>
                    <span className="flex-1">{t}</span>
                    {t === time ? <Icon name="check" size={14} className="text-ink-2" /> : null}
                  </MenuItem>
                ))}
              </div>
            </>
          )}
        </Dropdown>
      </div>
    </div>
  );
}
