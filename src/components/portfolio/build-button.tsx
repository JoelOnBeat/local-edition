"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice } from "../ui";
import { toShownError, type ShownError } from "../lib/use-async";
import { startBuild } from "../runs/run-store";

const PLAIN: Record<string, string> = {
  build_running: "A build is already running for this chain. It will finish on its own; open it from the run link when it does.",
  no_stores: "Add at least one store in Setup before building editions.",
  spend_cap: "This workspace has reached its model spend cap for now, so no new build can start.",
  rate_limited: "Too many builds in a short time. Wait a minute and try again.",
};

/** Starts the SSE build and opens the run view the moment the server names the run. */
export function BuildButton({ storeIds, force, label = "Build this week's editions", size = "md" }: {
  storeIds?: string[];
  force?: boolean;
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const runId = await startBuild({ storeIds, force });
      router.push(`/app/runs/${runId}`);
    } catch (e) {
      setError(toShownError(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <Button data-testid={force ? "build-force" : storeIds?.length === 1 ? "build-store" : "build-editions"} variant="primary" size={size} loading={busy} onClick={go}>
        {busy ? "Starting the agent…" : label}
      </Button>
      {error ? (
        <Notice tone="flag" className="max-w-md" data-testid="build-error">
          {(error.code && PLAIN[error.code]) || error.message}
        </Notice>
      ) : null}
    </div>
  );
}
