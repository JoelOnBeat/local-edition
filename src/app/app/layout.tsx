import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";
import { WorkspaceProvider } from "@/components/app/workspace-context";

export const metadata: Metadata = { title: { default: "Portfolio", template: "%s · Local Edition" } };

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
