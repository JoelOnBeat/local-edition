import type { OnboardingStep, OnboardingUpdate, WorkspaceBundle } from "@/contract";

/** What every onboarding step screen receives. `refresh` re-reads the progress and the workspace after a write. */
export interface StepProps {
  step: OnboardingStep;
  bundle: WorkspaceBundle;
  refresh: () => void;
  update: (change: OnboardingUpdate) => Promise<boolean>;
}
