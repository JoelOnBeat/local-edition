import type { Metadata } from "next";
import { SetupView } from "./_parts/setup-view";

export const metadata: Metadata = { title: "Setup" };

export default function SetupPage() {
  return <SetupView />;
}
