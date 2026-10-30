import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { SiteShell } from "@/components/site/site-chrome";
import { PublicBody, PublicHero } from "../proof/_parts/public-hero";
import { LimitsView } from "./_parts/limits-view";

export const metadata: Metadata = {
  title: "Limits",
  description: "Model spend, Qloo and Tavily budgets, rate limits, and where the data runs thin.",
};

export default function LimitsPage() {
  return (
    <SiteShell>
      <PublicHero
        pill="Limits"
        pillIcon={<Icon name="gauge" />}
        title="What it costs, and where it stops."
        lede="A hackathon build on shared keys, so every budget is small and every stop is deliberate. Read live from the same counters the app uses."
        meta="Last updated 30 Oct 2026"
        actions={<ButtonLink href="/proof" variant="secondary" size="sm">See what ran</ButtonLink>}
      />
      <PublicBody>
        <div className="mx-auto max-w-[920px]"><LimitsView /></div>
      </PublicBody>
    </SiteShell>
  );
}
