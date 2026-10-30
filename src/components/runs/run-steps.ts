import type { Lane, TraceEntry } from "./run-model";

/** The seven pipeline steps of one store's edition, and which trace entries belong to each. Pure, display only. */

export interface StepDef { id: string; title: string; body: string }

export const STEPS: StepDef[] = [
  { id: "menu", title: "Menu read", body: "Matches this store's menu to the block's taste so the special starts from something it sells." },
  { id: "profile", title: "Block profile", body: "Reads what this block over-indexes on against the city, from Qloo." },
  { id: "agent", title: "Edition agent", body: "Nemotron picks the special, the sound, a partner nearby and an event night, calling Qloo and Tavily for evidence." },
  { id: "copy", title: "Copy", body: "Writes each item in the chain's voice, one model call per item." },
  { id: "guardrails", title: "Guardrails", body: "Checks every line for health, diet and allergen claims before anyone reads it." },
  { id: "evidence", title: "Evidence check", body: "Keeps only items whose evidence holds up; the reviewer reads the chain side by side." },
  { id: "approval", title: "Approval", body: "The edition waits for head office. Nothing reaches a store until someone approves it." },
];

export type StepState = "idle" | "active" | "done" | "ready" | "failed";

const toolStep = (tool: string): number => {
  const t = tool.toLowerCase();
  if (/menu/.test(t)) return 0;
  if (/block_profile|profile/.test(t)) return 1;
  if (/write_|copy|compose/.test(t)) return 3;
  if (/guard|self_check/.test(t)) return 4;
  if (/review/.test(t)) return 5;
  return 2;
};

/** The step(s) an entry belongs to. A drafted item shows under Copy and, with its verdict, under Guardrails. */
export function stepsOf(e: TraceEntry): number[] {
  switch (e.kind) {
    case "tool": return [toolStep(e.tool)];
    case "model": return [e.step.tool ? toolStep(e.step.tool) : e.step.role === "copy" ? 3 : e.step.role === "review" ? 5 : e.step.role === "embed" ? 0 : 2];
    case "item": return e.guardrail ? [3, 4] : [3];
    case "review": return [5];
    case "error": return [];
  }
}

export interface StepView {
  def: StepDef;
  index: number;
  state: StepState;
  entries: TraceEntry[];
  calls: number;
  answered: number;
  ms: number;
  usd: number;
}

/** Each step's state for one lane: done before the step the agent is on, active on it, idle after it. */
export function deriveSteps(lane: Lane | undefined): StepView[] {
  const views: StepView[] = STEPS.map((def, index) => ({ def, index, state: "idle", entries: [], calls: 0, answered: 0, ms: 0, usd: 0 }));
  if (!lane) return views;
  let current = -1;
  for (const e of lane.entries) {
    const steps = stepsOf(e);
    for (const i of steps) {
      const v = views[i]!;
      v.entries.push(e);
      if (e.kind === "tool") {
        v.calls++;
        if (e.result) v.answered++;
      }
      if (e.kind === "model") {
        v.ms += e.step.ms;
        v.usd += e.step.usd;
      }
    }
    if (steps.length) current = Math.max(current, ...steps);
  }
  const done = lane.status === "done" || lane.status === "skipped";
  views.forEach((v) => {
    if (done) v.state = v.index === 6 ? (lane.status === "done" ? "ready" : "idle") : "done";
    else if (lane.status === "error") v.state = v.index < current ? "done" : v.index === Math.max(current, 0) ? "failed" : "idle";
    else if (lane.status === "working" || lane.status === "retrying") v.state = v.index < current ? "done" : v.index === Math.max(current, 0) ? "active" : "idle";
  });
  return views;
}
