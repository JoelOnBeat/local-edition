import type { Metadata } from "next";
import { OnboardingView } from "./_parts/onboarding-view";

export const metadata: Metadata = { title: "Set up your chain" };

export default function OnboardingPage() {
  return <OnboardingView />;
}
