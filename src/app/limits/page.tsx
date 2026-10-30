import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/site-chrome";
import { LimitsView } from "./_parts/limits-view";

export const metadata: Metadata = {
  title: "Limits",
  description: "Model spend, Qloo and Tavily budgets, rate limits, and where the data runs thin.",
};

export default function LimitsPage() {
  return (
    <SiteShell>
      <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-10 sm:px-6 md:py-14">
        <header className="grid gap-3">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">Limits</span>
          <h1 className="max-w-[20ch] font-display text-[clamp(36px,5.6vw,64px)] font-extrabold leading-[0.98] tracking-[-0.03em]">
            What it costs, and where it stops.
          </h1>
          <p className="max-w-[64ch] text-[17px] leading-[1.55] text-ink-2">
            A hackathon build on shared keys, so every budget is small and every stop is deliberate. What ran is on{" "}
            <Link href="/proof" className="font-semibold text-ink underline underline-offset-4">the proof page</Link>.
          </p>
        </header>
        <LimitsView />
      </div>
    </SiteShell>
  );
}
