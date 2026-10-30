import type { Metadata } from "next";
import { RunView } from "@/components/runs/run-view";

export const metadata: Metadata = { title: "Agent run" };

export default async function RunPage({ params }: PageProps<"/app/runs/[runId]">) {
  const { runId } = await params;
  return <RunView runId={runId} />;
}
