"use client";

import { SKIPPABLE_STEPS } from "@/contract";
import type { StepProps } from "./step-props";
import { AnchorsStep } from "./steps/anchors-step";
import { BasicsStep } from "./steps/basics-step";
import { BuildStep } from "./steps/build-step";
import { MenuStep } from "./steps/menu-step";
import { StoresStep } from "./steps/stores-step";
import { ToolsStep } from "./steps/tools-step";
import { VoiceStep } from "./steps/voice-step";

/** The frame around one step: its status, what is missing, the step's own controls, then skip / next. */
export function StepPanel(props: StepProps & { next: () => void }) {
  const { step, update, refresh, next } = props;
  const body = {
    basics: <BasicsStep {...props} />,
    menu: <MenuStep {...props} />,
    stores: <StoresStep {...props} />,
    voice: <VoiceStep {...props} />,
    anchors: <AnchorsStep {...props} />,
    tools: <ToolsStep {...props} />,
    build: <BuildStep {...props} />,
  }[step.id];
  return (
    <section data-testid="step-panel" data-step={step.id} data-status={step.status}>
      <h2>{step.title}</h2>
      {step.missing.length ? (
        <ul data-testid="step-missing">
          {step.missing.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
      {step.blockedBy.length ? <p data-testid="step-blocked" data-by={step.blockedBy.join(",")}>Finish first: {step.blockedBy.join(", ")}.</p> : null}
      {body}
      <p>
        {SKIPPABLE_STEPS.includes(step.id) && step.status !== "skipped" && step.status !== "done" ? (
          <button data-testid="step-skip" type="button" onClick={async () => { if (await update({ skip: [step.id] })) { refresh(); next(); } }}>
            Skip this step
          </button>
        ) : null}
        {step.status === "skipped" ? (
          <button data-testid="step-unskip" type="button" onClick={async () => { if (await update({ unskip: [step.id] })) refresh(); }}>
            Do this step after all
          </button>
        ) : null}{" "}
        <button data-testid="step-next" type="button" onClick={next}>Next step</button>
      </p>
    </section>
  );
}
