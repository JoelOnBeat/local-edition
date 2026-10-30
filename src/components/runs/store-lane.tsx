"use client";

import type { Store } from "@/contract";
import { StoreTile, cx } from "../ui";
import { Icon, type IconName } from "../app-ui/icons";
import type { Lane } from "./run-model";

export const LANE_STATUS: Record<Lane["status"], { label: string; icon?: IconName; cls: string }> = {
  queued: { label: "Queued", icon: "clock", cls: "text-faint" },
  working: { label: "Working", cls: "text-accent-text" },
  retrying: { label: "Retrying", icon: "refresh", cls: "text-warn-ink" },
  done: { label: "Drafted", icon: "check", cls: "text-ok-ink" },
  skipped: { label: "Skipped", icon: "minus", cls: "text-warn-ink" },
  error: { label: "Failed", icon: "alert", cls: "text-flag" },
};

/**
 * The store switcher above the dark panel: one tile per lane of the run (active one ringed in flame). Each item keeps the
 * lane test ids: `lane-<id>` carries the lane status, `lane-toggle-<id>` picks the store shown in the panel.
 */
export function StoreSwitcher({ lanes, storeById, picked, onPick }: {
  lanes: Lane[];
  storeById: (id: string) => Store | undefined;
  picked: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Stores in this run" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {lanes.map((l) => {
        const s = storeById(l.storeId);
        const st = LANE_STATUS[l.status];
        const active = picked === l.storeId;
        const live = l.status === "working" || l.status === "retrying";
        return (
          <div key={l.storeId} data-testid={`lane-${l.storeId}`} data-status={l.status} className="min-w-0">
            <button
              type="button"
              role="tab"
              data-testid={`lane-toggle-${l.storeId}`}
              aria-selected={active}
              onClick={() => onPick(l.storeId)}
              title={`${s?.name ?? l.storeId}: ${st.label}`}
              className={cx(
                "flex h-10 w-full min-w-0 items-center gap-2 rounded-[10px] bg-white pl-1.5 pr-3 text-[14px] font-medium text-ink-strong transition-[box-shadow,scale] duration-150 active:scale-[.97]",
                active ? "shadow-[0_0_0_2px_var(--paper),0_0_0_4px_var(--accent)]" : "shadow-ring-xs hover:bg-stone-50",
              )}
            >
              <StoreTile colorIndex={s?.colorIndex ?? 1} name={s?.name ?? l.storeId} size="lg" />
              <span className="min-w-0 flex-1 truncate text-left">{s?.name ?? l.storeId}</span>
              {live ? <span className="le-live-dot size-1.5 shrink-0 rounded-full bg-accent" /> : st.icon ? <Icon name={st.icon} size={13} strokeWidth={2.4} className={cx("shrink-0", st.cls)} /> : null}
              <span className="sr-only">{st.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
