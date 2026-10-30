import { SampleChainLink } from "@/components/account/session-links";
import type { Metadata } from "next";
import { LandingEdition } from "@/components/site/landing-edition";
import { HackathonNote, LandingHero } from "@/components/site/landing-hero";
import { LandingIntegrations } from "@/components/site/landing-integrations";
import { LandingLoop } from "@/components/site/landing-loop";
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
      <LandingLoop />
      <LandingEdition />
      <LandingIntegrations />
      <section>
        <div className="mx-auto grid max-w-[1180px] gap-6 px-4 py-16 sm:px-6 md:grid-cols-[1.3fr_1fr] md:items-center">
          <div className="grid gap-3">
            <h2 className="font-(family-name:--font-display) text-[clamp(30px,4vw,46px)] font-extrabold leading-[1.02] tracking-[-0.02em] text-balance">
              Open the sample chain and approve an edition.
            </h2>
            <p className="max-w-[56ch] text-[16px] leading-[1.55] text-(--ink-2)">
              Eight Kettle &amp; Kiln stores, this week&apos;s editions, the evidence drawer and the staff cards. Each visitor gets a
              private copy, so nothing you approve changes what anyone else sees.
            </p>
          </div>
          <div className="grid gap-4">
            <SampleChainLink
              className="justify-self-start rounded-(--radius) bg-(--accent) px-5 py-3 text-[16px] font-semibold text-(--accent-ink) hover:opacity-90"
              signedOutLabel="Try the sample chain"
            />
            <HackathonNote />
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
