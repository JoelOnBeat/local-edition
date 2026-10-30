"use client";

import { useState } from "react";
import type { Connection } from "@/contract";
import { ErrorLine } from "@/components/account/plain";
import { connect } from "@/components/connections/connections-api";
import { toShownError, useAsync, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

/** Optional tools: Slack, Gmail or Outlook, and the calendar feed. Each Connect starts the provider's own consent flow. */
export function ToolsStep({ refresh }: StepProps) {
  const loaded = useAsync("onboarding:connections", () => getApi().getConnections());
  const [error, setError] = useState<ShownError | undefined>();
  const tools = (loaded.data?.connections ?? []).filter((c: Connection) => c.provider !== "square" && c.provider !== "eventbrite");

  const go = async (provider: Connection["provider"]) => {
    setError(undefined);
    try {
      const url = await connect(provider);
      if (url) return void window.location.assign(url);
      loaded.reload();
      refresh();
    } catch (e) {
      setError(toShownError(e));
    }
  };
  return (
    <div>
      <ul data-testid="tools-list">
        {tools.map((c) => (
          <li key={c.provider} data-testid={`tool-${c.provider}`} data-status={c.status}>
            {c.provider}: {c.status}{c.accountLabel ? ` (${c.accountLabel})` : ""}{" "}
            {c.provider !== "calendar" && c.status !== "connected" ? (
              <button data-testid={`tools-connect-${c.provider}`} type="button" onClick={() => void go(c.provider)}>Connect</button>
            ) : null}
          </li>
        ))}
      </ul>
      <p>The calendar feed appears under Connections once an event night is approved.</p>
      <ErrorLine error={error ?? loaded.error} testId="tools-error" />
    </div>
  );
}
