"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem, Store } from "@/contract";
import { StoreTile, cx } from "../ui";
import { Icon } from "../app-ui/icons";
import { formatInt } from "../lib/format";
import type { Lane } from "./run-model";
import { deriveSteps, stepsOf } from "./run-steps";
import { StepTabs } from "./step-tabs";
import { LANE_STATUS } from "./store-lane";
import { DarkChip, TraceLine, usd } from "./trace-entry";

/**
 * The dark run panel (ByDefault's how-it-works panel): the pipeline steps on the left, the picked store's stream of tool
 * calls, model calls and drafted items on the right. Below lg the steps sit under the stream.
 */
export function TracePanel({ lane, store, live, menuSource }: { lane: Lane | undefined; store?: Store; live: boolean; menuSource?: MenuItem["source"] }) {
  const steps = useMemo(() => deriveSteps(lane), [lane]);
  const [selected, setSelected] = useState<number | null>(null);
  const [laneId, setLaneId] = useState(lane?.storeId);
  if (laneId !== lane?.storeId) {
    setLaneId(lane?.storeId);
    setSelected(null);
  }
  const activeStep = steps.find((s) => s.state === "active")?.index ?? null;
  const expanded = selected ?? activeStep;
  const entries = useMemo(
    () => (lane?.entries ?? []).filter((e) => selected === null || stepsOf(e).includes(selected) || e.kind === "error"),
    [lane, selected],
  );
  const pane = useRef<HTMLDivElement>(null);
  const follow = live && selected === null;
  useEffect(() => {
    const el = pane.current;
    if (follow && el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [entries.length, follow]);
  useEffect(() => {
    pane.current?.scrollTo({ top: 0 });
  }, [selected, laneId]);

  const st = lane ? LANE_STATUS[lane.status] : null;
  const name = store?.name ?? lane?.storeId ?? "";

  return (
    <div className="rounded-[22px] bg-band p-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]">
      <div className="grid overflow-hidden rounded-2xl bg-band-panel shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)] lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="order-2 border-t border-band-rule lg:order-1 lg:border-r lg:border-t-0">
          <StepTabs steps={steps} expanded={expanded} selected={selected} onSelect={(i) => setSelected((cur) => (cur === i ? null : i))} />
        </div>
        <div className="order-1 flex min-w-0 flex-col bg-band-inner lg:order-2 lg:h-[600px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-band-rule px-4 py-3 sm:px-5">
            {lane ? <StoreTile colorIndex={store?.colorIndex ?? 1} name={name} size="lg" /> : null}
            <span className="min-w-[150px] flex-1">
              <span className="block truncate text-[14px] font-medium leading-5 text-band-ink">{lane ? name : "Agent trace"}</span>
              {lane ? (
                <span className="block truncate font-mono text-[12px] leading-5 text-band-ink-3 tnum">
                  {lane.toolCalls} calls · {formatInt(lane.tokens)} tok · {usd(lane.usd)}
                </span>
              ) : null}
            </span>
            {selected !== null ? (
              <button type="button" onClick={() => setSelected(null)} className="inline-flex h-6 items-center gap-1 rounded-md bg-white/[.06] px-2 text-[12px] font-medium text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.12)] hover:bg-white/10">
                {steps[selected]!.def.title}<Icon name="x" size={12} />
              </button>
            ) : null}
            {lane && st ? (
              <DarkChip icon={st.icon} className={cx(lane.status === "working" && "text-band-ink")}>
                {lane.status === "working" ? <span className="mr-0.5 inline-block size-1.5 rounded-full bg-accent align-middle le-live-dot" aria-hidden /> : null}
                {st.label}
              </DarkChip>
            ) : null}
          </div>
          <div ref={pane} className="no-scrollbar max-h-[520px] min-h-[280px] flex-1 overflow-y-auto px-3 py-3 sm:px-4 lg:max-h-none lg:min-h-0">
            {!lane ? (
              <Waiting text="Waiting for the agent to pick up the stores." />
            ) : entries.length === 0 ? (
              <Waiting text={selected !== null ? `No ${steps[selected]!.def.title.toLowerCase()} calls for this store yet.` : lane.status === "working" ? "The agent is planning this store's calls." : "Waiting for the agent to reach this store."} live={lane.status === "working"} />
            ) : (
              <ol className="grid gap-1.5">
                {entries.map((e) => <TraceLine key={e.key} e={e} menuSource={menuSource} />)}
              </ol>
            )}
            {lane?.editionId ? (
              <Link
                href={`/app/stores/${lane.storeId}`}
                className="group mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-white/[.06] px-3 text-[13px] font-medium text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.12)] transition-colors hover:bg-white/10"
              >
                Open the {name} edition
                <Icon name="arrowRight" size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Waiting({ text, live }: { text: string; live?: boolean }) {
  return (
    <p className="flex items-center gap-2 px-2 py-6 text-[14px] text-band-ink-3">
      {live ? <span className="le-live-dot size-1.5 rounded-full bg-accent" /> : <Icon name="clock" size={14} />}
      {text}
    </p>
  );
}
