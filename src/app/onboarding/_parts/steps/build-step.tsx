"use client";

import { ErrorLine } from "@/components/account/plain";
import { useFirstBuild } from "@/components/account/use-build";
import type { StepProps } from "../step-props";

/** Build the first editions (one agent run for every store), then approve them. */
export function BuildStep({ step, refresh }: StepProps) {
  const first = useFirstBuild(refresh);
  return (
    <div>
      <button data-testid="build-start" type="button" disabled={step.blockedBy.length > 0 || first.phase === "building" || first.phase === "approving"} onClick={() => void first.build()}>
        Build the first editions
      </button>
      <p data-testid="build-phase" data-phase={first.phase}>{first.phase}</p>
      <ol data-testid="build-log">{first.log.map((l, i) => <li key={i}>{l}</li>)}</ol>
      {first.editions.length ? (
        <>
          <ul data-testid="build-editions">
            {first.editions.map((e) => <li key={e.id} data-testid="build-edition" data-status={e.status}>{e.storeId}: {e.status}</li>)}
          </ul>
          <button data-testid="build-approve-all" type="button" disabled={first.phase === "approving" || first.phase === "approved"} onClick={() => void first.approveAll()}>
            Approve all editions
          </button>
        </>
      ) : null}
      <ErrorLine error={first.error} testId="build-error" />
    </div>
  );
}
