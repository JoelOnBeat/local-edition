import type { Metadata } from "next";
import { HowItWorksView } from "@/components/app/how-it-works-view";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return <HowItWorksView />;
}
