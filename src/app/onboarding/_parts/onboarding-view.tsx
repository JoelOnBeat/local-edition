"use client";

import Link from "next/link";
import { useState } from "react";
import { ONBOARDING_STEPS, type OnboardingStepId } from "@/contract";
import { AccountMenu } from "@/components/account/account-menu";
import { ErrorLine } from "@/components/account/plain";
import { useChainBundle } from "@/components/account/use-chain";
import { useOnboarding } from "@/components/account/use-onboarding";
import { StepPanel } from "./step-panel";

/**
 * Plain test screen: one onboarding step per screen. All state lives in the hooks (useOnboarding, useChainBundle); this file only
 * picks which step to show. `data-status` on each nav button is done | skipped | todo.
 */
export function OnboardingView() {
  const onboarding = useOnboarding();
  const chain = useChainBundle();
  const [picked, setPicked] = useState<OnboardingStepId | null>(null);
  const state = onboarding.state;
  const shown = picked ?? state?.current ?? null;
  const step = state?.steps.find((s) => s.id === shown);

  const refresh = () => {
    onboarding.refresh();
    chain.reload();
  };
  const next = (from: OnboardingStepId) => setPicked(ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(from) + 1] ?? null);

  return (
    <main style={{ padding: 16, maxWidth: 720 }}>
      <AccountMenu />
      <h1>Set up your chain</h1>
      <ErrorLine error={onboarding.error ?? chain.error} testId="onboarding-error" />
      {!state || !chain.bundle ? <p data-testid="onboarding-loading">Loading...</p> : null}
      {state ? (
        <>
          <ol data-testid="onboarding-steps">
            {state.steps.map((s) => (
              <li key={s.id}>
                <button data-testid={`step-nav-${s.id}`} data-status={s.status} aria-current={s.id === shown ? "step" : undefined} type="button" onClick={() => setPicked(s.id)}>
                  {s.title}
                </button>{" "}
                <span data-testid={`step-status-${s.id}`}>{s.status}{s.optional ? " (optional)" : ""}</span>
              </li>
            ))}
          </ol>
          {state.complete ? (
            <p data-testid="onboarding-complete">
              Everything is set up. <Link data-testid="onboarding-open-app" href="/app">Open your portfolio</Link>
            </p>
          ) : null}
          {step && chain.bundle ? (
            <StepPanel
              key={step.id}
              step={step}
              bundle={chain.bundle}
              refresh={refresh}
              update={onboarding.update}
              next={() => next(step.id)}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}
