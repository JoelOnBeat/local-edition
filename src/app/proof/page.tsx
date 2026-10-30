import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/site-chrome";
import { ProofView } from "./_parts/proof-view";

export const metadata: Metadata = {
  title: "Proof",
  description: "Which model did each step, the Nemotron Ultra review, NeMo Guardrails eval results and the latest Nebius job runs.",
};

export default function ProofPage() {
  return (
    <SiteShell>
      <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-10 sm:px-6 md:py-14">
        <header className="grid gap-3">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">Proof</span>
          <h1 className="max-w-[20ch] font-display text-[clamp(36px,5.6vw,64px)] font-extrabold leading-[0.98] tracking-[-0.03em]">
            What ran, and how well it worked.
          </h1>
          <p className="max-w-[64ch] text-[17px] leading-[1.55] text-ink-2">
            Read from the same data the app uses. What Local Edition cannot do yet is on{" "}
            <Link href="/limits" className="font-semibold text-ink underline underline-offset-4">the limits page</Link>.
          </p>
        </header>
        <ProofView />
      </div>
    </SiteShell>
  );
}
