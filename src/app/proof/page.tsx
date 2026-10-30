import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { SiteShell } from "@/components/site/site-chrome";
import { PublicBody, PublicHero } from "./_parts/public-hero";
import { ProofView } from "./_parts/proof-view";

export const metadata: Metadata = {
  title: "Proof",
  description: "Which model did each step, the Nemotron Ultra review, NeMo Guardrails eval results and the latest Nebius job runs.",
};

export default function ProofPage() {
  return (
    <SiteShell>
      <PublicHero
        pill="Proof"
        pillIcon={<Icon name="shield" />}
        title="What ran, and how well it worked."
        lede="Read from the same data the app uses: the model behind each step, what the guardrails caught, and every Nebius job run."
        actions={
          <>
            <ButtonLink href="/limits" variant="secondary" size="sm">Read the limits</ButtonLink>
            <ButtonLink href="#guardrails" variant="ghost" size="sm">Guardrail results</ButtonLink>
          </>
        }
      />
      <PublicBody>
        <ProofView />
      </PublicBody>
    </SiteShell>
  );
}
