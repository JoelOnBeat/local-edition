"use client";

import { SKIPPABLE_STEPS } from "@/contract";
import { Button } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import type { StepProps } from "./step-props";
import { AnchorsStep } from "./steps/anchors-step";
import { BasicsStep } from "./steps/basics-step";
import { BuildStep } from "./steps/build-step";
import { MenuStep } from "./steps/menu-step";
import { StoresStep } from "./steps/stores-step";
import { ToolsStep } from "./steps/tools-step";
import { VoiceStep } from "./steps/voice-step";

/** The open step: what is still missing, the step's own controls, then skip / next. */
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
  const canSkip = SKIPPABLE_STEPS.includes(step.id) && step.status !== "skipped" && step.status !== "done";
  return (
    <section data-testid="step-panel" data-step={step.id} data-status={step.status} aria-label={step.title} className="grid gap-5">
      {step.missing.length ? (
        <ul data-testid="step-missing" className="grid gap-1.5 rounded-lg bg-paper-2 px-3.5 py-3 text-[14px] leading-5 text-ink-2 shadow-[inset_0_0_0_1px_var(--rule-subtle)]">
          {step.missing.map((m) => (
            <li key={m} className="flex gap-2.5">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
              <span className="min-w-0">{m}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {step.blockedBy.length ? (
        <p data-testid="step-blocked" data-by={step.blockedBy.join(",")} className="flex items-start gap-2.5 rounded-lg bg-warn-bg px-3.5 py-3 text-[14px] leading-5 text-warn-ink">
          <Icon name="triangle" size={16} className="mt-0.5 shrink-0" />
          <span>Finish first: {step.blockedBy.join(", ")}.</span>
        </p>
      ) : null}
      {body}
      <div className="flex flex-wrap items-center gap-2 border-t border-rule-subtle pt-4">
        {canSkip ? (
          <Button data-testid="step-skip" size="sm" variant="ghost" className="-ml-2.5" onClick={async () => { if (await update({ skip: [step.id] })) { refresh(); next(); } }}>
            Skip this step
          </Button>
        ) : null}
        {step.status === "skipped" ? (
          <Button data-testid="step-unskip" size="sm" variant="ghost" className="-ml-2.5" onClick={async () => { if (await update({ unskip: [step.id] })) refresh(); }}>
            Do this step after all
          </Button>
        ) : null}
        <Button data-testid="step-next" size="sm" variant="secondary" chevron className="ml-auto" onClick={next}>
          Next step
        </Button>
      </div>
    </section>
  );
}
