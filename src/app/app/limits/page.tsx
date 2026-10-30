import type { Metadata } from "next";
import { Pill } from "@/components/ui";
import { Band, Gap, Page, PageHeader } from "@/components/app-ui/frame";
import { Icon } from "@/components/app-ui/icons";
import { LimitsView } from "@/app/limits/_parts/limits-view";

export const metadata: Metadata = { title: "Limits" };

/** Limits inside the app: spend, budgets and rate limits, the same view as /limits. */
export default function AppLimitsPage() {
  return (
    <Page>
      <PageHeader
        pill={<Pill icon={<Icon name="gauge" />}>Limits</Pill>}
        title="What it costs, and where it stops"
        lede="Every budget is small and every stop is deliberate. Calls stop with a plain message when a cap is reached."
      />
      <Gap />
      <Band grow>
        <LimitsView />
      </Band>
    </Page>
  );
}
