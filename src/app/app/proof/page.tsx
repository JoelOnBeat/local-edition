import type { Metadata } from "next";
import { Pill } from "@/components/ui";
import { Band, Gap, Page, PageHeader } from "@/components/app-ui/frame";
import { Icon } from "@/components/app-ui/icons";
import { ProofView } from "@/app/proof/_parts/proof-view";

export const metadata: Metadata = { title: "Proof" };

/** Proof inside the app: the same measured view as /proof, without the website chrome. */
export default function AppProofPage() {
  return (
    <Page>
      <PageHeader
        pill={<Pill icon={<Icon name="shield" />}>Proof</Pill>}
        title="What ran, and how well it worked"
        lede="The model behind each step, Ultra's review of the chain, and how often NeMo Guardrails got it right."
      />
      <Gap />
      <Band grow>
        <ProofView />
      </Band>
    </Page>
  );
}
