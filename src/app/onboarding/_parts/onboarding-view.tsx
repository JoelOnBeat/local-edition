"use client";

import { useState } from "react";
import { ONBOARDING_STEPS, type OnboardingStep, type OnboardingStepId } from "@/contract";
import { AccountDangerZone, AccountMenu } from "@/components/account/account-menu";
import { ErrorLine } from "@/components/account/plain";
import { useChainBundle } from "@/components/account/use-chain";
import { useOnboarding } from "@/components/account/use-onboarding";
import { ButtonLink, Pill, SampleBadge, Skeleton, cx } from "@/components/ui";
import { FocusedBand, FocusedColumn, FocusedPage } from "@/components/app-ui/form-focused";
import { Icon } from "@/components/app-ui/icons";
import { StepItem, StepStatusWord, type StepState } from "@/components/app-ui/stepper-list";
import { StepPanel } from "./step-panel";

/** One line under each step's title: what it is for, so the list reads as a plan. */
const HINT: Record<OnboardingStepId, string> = {
  basics: "Name, category and home city",
  menu: "From Square, or a photo of the menu board",
  stores: "Every location, with its corner on the map",
  voice: "Up to three lines on how you talk",
  anchors: "Brands your customers also love, via Qloo",
  tools: "Slack, Gmail or Outlook for delivery",
  build: "One agent run for every store",
};

const stateOf = (s: OnboardingStep, shown: boolean): StepState =>
  shown ? "current" : s.status === "done" ? "done" : s.status === "skipped" ? "skipped" : "todo";

/**
 * /onboarding: the seven setup steps as a stepper list in the focused layout. Hooks own all state (useOnboarding,
 * useChainBundle); this view picks which step is open. `data-status` on each step button is done | skipped | todo.
 */
export function OnboardingView() {
  const onboarding = useOnboarding();
  const chain = useChainBundle();
  const [picked, setPicked] = useState<OnboardingStepId | null>(null);
  const state = onboarding.state;
  const shown = picked ?? state?.current ?? null;
  const step = state?.steps.find((s) => s.id === shown);
  const done = state?.steps.filter((s) => s.status !== "todo").length ?? 0;
  const position = shown ? ONBOARDING_STEPS.indexOf(shown) + 1 : ONBOARDING_STEPS.length;
  const chainName = chain.bundle?.chain.name.replace(/\s*\(sample chain\)\s*$/i, "");

  const refresh = () => {
    onboarding.refresh();
    chain.reload();
  };
  const next = (from: OnboardingStepId) => setPicked(ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(from) + 1] ?? null);
  const error = onboarding.error ?? chain.error;

  return (
    <FocusedPage home="/app" right={<AccountMenu variant="inline" />}>
      <FocusedColumn className="pb-10 pt-8 md:pb-12 md:pt-14">
        <Pill icon={<Icon name="list" />} badge={chain.bundle?.chain.isSample ? <SampleBadge /> : undefined}>
          {state?.complete ? "Setup · complete" : `Setup · step ${position} of ${ONBOARDING_STEPS.length}`}
        </Pill>
        <h1 className="mt-5 text-[30px] font-medium leading-[1.1] tracking-[-0.02em] text-ink [overflow-wrap:anywhere] md:text-[36px] md:leading-10">
          {chainName ? `Set up ${chainName}` : "Set up your chain"}
        </h1>
        <p className="mt-3 max-w-[560px] text-[16px] leading-6 text-ink-2">
          Seven steps and every store gets its own Monday edition. Each one saves on its own, and everything stays editable later.
        </p>
        {state ? (
          <div className="mt-6 flex items-center gap-3" aria-hidden>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200/70">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-quint" style={{ width: `${(done / state.steps.length) * 100}%` }} />
            </div>
            <span className="text-[13px] font-medium text-ink-2 tnum">{done} of {state.steps.length} done</span>
          </div>
        ) : null}
      </FocusedColumn>

      <FocusedBand>
        <div className="ring-after relative rounded-xl bg-white px-4 py-5 sm:px-7 sm:py-7">
          {error ? (
            <div className="mb-5 rounded-lg bg-flag-bg px-3.5 py-2.5"><ErrorLine error={error} testId="onboarding-error" /></div>
          ) : null}
          {!state || !chain.bundle ? <StepsSkeleton /> : null}
          {state ? (
            <>
              {state.complete ? (
                <div data-testid="onboarding-complete" className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-ok-bg px-4 py-3.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-ok-ink shadow-plate"><Icon name="check" size={14} strokeWidth={2.4} /></span>
                  <p className="min-w-0 flex-1 text-[15px] leading-6 text-ok-strong">
                    <span className="font-medium">Everything is set up.</span> The first editions are on the portfolio.
                  </p>
                  <ButtonLink data-testid="onboarding-open-app" href="/app" variant="primary" size="sm" chevron>Open your portfolio</ButtonLink>
                </div>
              ) : null}
              <ol data-testid="onboarding-steps" className={cx(!chain.bundle && "hidden")}>
                {state.steps.map((s, i) => {
                  const open = s.id === shown;
                  const st = stateOf(s, open);
                  return (
                    <StepItem
                      key={s.id}
                      n={i + 1}
                      state={st}
                      last={i === state.steps.length - 1}
                      row={
                        <button
                          type="button"
                          data-testid={`step-nav-${s.id}`}
                          data-status={s.status}
                          aria-current={open ? "step" : undefined}
                          aria-expanded={open}
                          onClick={() => setPicked(s.id)}
                          className="group -mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-[10px] px-2 py-2.5 text-left transition-colors duration-150 hover:bg-hover-tint"
                        >
                          <span className="min-w-0 flex-1">
                            <span className={cx("block truncate text-[16px] font-medium leading-6", s.status === "skipped" && !open ? "text-muted" : "text-ink")}>{s.title}</span>
                            <span className="block text-[13px] leading-5 text-muted sm:truncate">{HINT[s.id]}</span>
                          </span>
                          <span data-testid={`step-status-${s.id}`} className="flex shrink-0 items-center gap-2">
                            <StepStatusWord state={s.status === "todo" ? "todo" : (s.status as StepState)} optional={s.optional} />
                            <span className="sr-only">{s.status}{s.optional ? " (optional)" : ""}</span>
                          </span>
                          <Icon name="chevronDown" size={14} className={cx("shrink-0 text-faint transition-transform duration-200 ease-quint", open && "rotate-180 text-ink-2")} />
                        </button>
                      }
                    >
                      {open && step && chain.bundle ? (
                        <div className="le-label-in pb-6 pt-3">
                          <StepPanel key={step.id} step={step} bundle={chain.bundle} refresh={refresh} update={onboarding.update} next={() => next(step.id)} />
                        </div>
                      ) : null}
                    </StepItem>
                  );
                })}
              </ol>
            </>
          ) : null}
        </div>
      </FocusedBand>

      <FocusedColumn className="pt-8">
        <div className="flex flex-wrap items-start justify-end gap-x-6 gap-y-3 text-[14px] leading-5 text-muted">
          <AccountDangerZone quiet />
        </div>
      </FocusedColumn>
    </FocusedPage>
  );
}

function StepsSkeleton() {
  return (
    <div data-testid="onboarding-loading" role="status" aria-label="Loading your setup" className="grid gap-5">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="size-7 rounded-lg" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3 w-40 rounded-full" />
            <Skeleton className="h-2.5 w-64 max-w-full rounded-full" />
          </div>
          <Skeleton className="h-6 w-14" />
        </div>
      ))}
    </div>
  );
}
