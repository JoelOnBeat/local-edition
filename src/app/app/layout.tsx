import type { Metadata } from "next";
import { SessionGuard } from "@/components/account/session-guard";
import { AppShell } from "@/components/app/app-shell";
import { WorkspaceProvider } from "@/components/app/workspace-context";

export const metadata: Metadata = { title: { default: "Portfolio", template: "%s · Local Edition" } };

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <SessionGuard>
      <WorkspaceProvider>
        <AppShell>{children}</AppShell>
      </WorkspaceProvider>
    </SessionGuard>
  );
}
