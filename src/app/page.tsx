import type { Metadata } from "next";
import { LandingBand } from "@/components/site/landing-band";
import { LandingEdition } from "@/components/site/landing-edition";
import { LandingEvidence } from "@/components/site/landing-evidence";
import { LandingFaq } from "@/components/site/landing-faq";
import { BuiltOnStrip, LandingHero } from "@/components/site/landing-hero";
import { LandingPortfolio } from "@/components/site/landing-portfolio";
import { SiteShell } from "@/components/site/site-chrome";

export const metadata: Metadata = {
  title: { absolute: "Local Edition: a weekly edition for every store in your chain" },
  description:
    "A special from your own menu, a sound brief, a neighbour partner and an event night for each store, built from the taste of its block with Qloo and NVIDIA Nemotron, approved by head office.",
};

export default function Home() {
  return (
    <SiteShell>
      <LandingHero />
      <BuiltOnStrip />
      <LandingPortfolio />
      <LandingEvidence />
      <div className="h-12" aria-hidden />
      <LandingBand />
      <div className="h-12" aria-hidden />
      <LandingEdition />
      <LandingFaq />
    </SiteShell>
  );
}
