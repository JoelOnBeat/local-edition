import type { Metadata } from "next";
import { RunsIndex } from "@/components/runs/runs-index";

export const metadata: Metadata = { title: "Agent runs" };

export default function RunsPage() {
  return <RunsIndex />;
}
