import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectionsView } from "@/components/connections/connections-view";

export const metadata: Metadata = { title: "Connections" };

export default function ConnectionsPage() {
  return (
    <Suspense>
      <ConnectionsView />
    </Suspense>
  );
}
