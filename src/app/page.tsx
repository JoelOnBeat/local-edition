import type { Metadata } from "next";
import { connection } from "next/server";
import { LandingBand } from "@/components/site/landing-band";
import { LandingEdition } from "@/components/site/landing-edition";
import { LandingEvidence } from "@/components/site/landing-evidence";
import { LandingFaq } from "@/components/site/landing-faq";
import { BuiltOnStrip, LandingHero } from "@/components/site/landing-hero";
import { LandingPortfolio } from "@/components/site/landing-portfolio";
import { LandingTiles } from "@/components/site/landing-tiles";
import { SiteShell } from "@/components/site/site-chrome";
import { landingSample } from "@/server/landing/sample";

export const metadata: Metadata = {
  title: { absolute: "Local Edition: a weekly edition for every store in your chain" },
  description:
    "A special from your own menu, a sound brief, a neighbour partner and an event night for each store, built from the taste of its block with Qloo and NVIDIA Nemotron, approved by head office.",
};

/** Dynamic: this week's sample editions and taste numbers are read from the demo workspace at request time (saved for ten minutes). */
export default async function Home() {
  await connection();
  const sample = await landingSample();
  return (
    <SiteShell>
      <LandingHero />
      <BuiltOnStrip />
      <LandingPortfolio sample={sample} />
      <LandingEvidence sample={sample} />
      <div className="h-12" aria-hidden />
      <LandingBand sample={sample} />
      <LandingTiles />
      <LandingEdition sample={sample} />
      <LandingFaq />
    </SiteShell>
  );
}
