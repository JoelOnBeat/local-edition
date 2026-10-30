"use client";

import { useState } from "react";
import type { Connection } from "@/contract";
import { ErrorLine } from "@/components/account/plain";
import { connect } from "@/components/connections/connections-api";
import { Button, Chip } from "@/components/ui";
import { SkeletonRows } from "@/components/app-ui/states";
import { LogoTile, PROVIDER_NAME } from "@/components/app-ui/tiles";
import { toShownError, useAsync, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

const ROLE: Partial<Record<Connection["provider"], string>> = {
  slack: "Posts each store's staff card to its channel",
  gmail: "Sends staff cards and reads store replies",
  outlook: "The same as Gmail, for Microsoft 365",
  calendar: "Event nights as a feed; appears after an approval",
};
const TONE: Record<Connection["status"], { tone: "ok" | "warn" | "flag" | "neutral"; label: string }> = {
  connected: { tone: "ok", label: "Connected" }, connecting: { tone: "warn", label: "Connecting" }, error: { tone: "flag", label: "Needs attention" }, not_connected: { tone: "neutral", label: "Not connected" },
};

/** Optional tools: Slack, Gmail or Outlook, and the calendar feed. Each Connect starts the provider's own consent flow. */
export function ToolsStep({ refresh }: StepProps) {
  const loaded = useAsync("onboarding:connections", () => getApi().getConnections());
  const [error, setError] = useState<ShownError | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const tools = (loaded.data?.connections ?? []).filter((c: Connection) => c.provider !== "square" && c.provider !== "eventbrite");

  const go = async (provider: Connection["provider"]) => {
    setError(undefined);
    setBusy(provider);
    try {
      const url = await connect(provider);
      if (url) return void window.location.assign(url);
      loaded.reload();
      refresh();
    } catch (e) {
      setError(toShownError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-4">
      <p className="text-[14px] leading-5 text-ink-2">Where approved editions go. All optional: you can connect these later under Connections.</p>
      {loaded.loading && !loaded.data ? <div className="overflow-hidden rounded-lg bg-white shadow-ring-xs"><SkeletonRows rows={4} cols={2} /></div> : null}
      <ul data-testid="tools-list" className={tools.length ? "overflow-hidden rounded-lg bg-white shadow-ring-xs" : "hidden"}>
        {tools.map((c) => (
          <li key={c.provider} data-testid={`tool-${c.provider}`} data-status={c.status} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule-row px-3.5 py-3 last:border-0">
            <LogoTile provider={c.provider} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink-strong">{PROVIDER_NAME[c.provider]}</span>
              <span className="block truncate text-[13px] text-muted">{c.accountLabel ?? ROLE[c.provider] ?? ""}</span>
            </span>
            <Chip tone={TONE[c.status].tone} dot>{TONE[c.status].label}</Chip>
            {c.provider !== "calendar" && c.status !== "connected" ? (
              <Button data-testid={`tools-connect-${c.provider}`} size="sm" loading={busy === c.provider} disabled={busy !== null} onClick={() => void go(c.provider)}>Connect</Button>
            ) : null}
          </li>
        ))}
      </ul>
      <ErrorLine error={error ?? loaded.error} testId="tools-error" />
    </div>
  );
}
