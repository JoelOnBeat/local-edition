"use client";

import { useRouter } from "next/navigation";
import { ButtonLink, CardBand, EmptyState, Pill } from "../ui";
import { Cell, DataRow, DataTable } from "../app-ui/data-table";
import { Band, Gap, Page, PageHeader } from "../app-ui/frame";
import { Icon } from "../app-ui/icons";
import { formatInt } from "../lib/format";
import { RunStateChip } from "./last-run-card";
import { runWhen, useKnownRuns } from "./run-summary";
import { ModelChip, usd } from "./trace-entry";

const GRID =
  "grid-cols-[minmax(0,1fr)_64px] sm:grid-cols-[minmax(0,1fr)_110px_72px] md:grid-cols-[minmax(0,1fr)_110px_72px_84px_80px] " +
  "lg:grid-cols-[minmax(0,1fr)_110px_72px_84px_84px_80px_minmax(0,1fr)]";

/** /app/runs: every build this tab started or replayed, newest first. Traces live in the tab, so this is an honest local list. */
export function RunsIndex() {
  const router = useRouter();
  const runs = useKnownRuns();

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/app", label: "Portfolio" }, { label: "Agent runs" }]}
        pill={<Pill icon={<Icon name="terminal" />}>Agent runs</Pill>}
        title="Agent runs"
        lede="Every build this browser tab started: stores done, tool calls, tokens, cost and the models that ran. Open one to replay its trace."
      />
      <Gap />
      <Band grow>
        {runs.length === 0 ? (
          <CardBand title="Runs" icon={<Icon name="terminal" />} flush className="flex-1" bodyClassName="flex flex-1 items-center justify-center min-h-[360px]">
            <EmptyState
              icon={<Icon name="terminal" size={20} />}
              title="No run in this browser yet"
              body="A build streams its trace to the tab that starts it. Build this week's editions from the portfolio to watch the agent work."
              action={<ButtonLink href="/app" variant="primary" size="sm" chevron>Go to the portfolio</ButtonLink>}
            />
          </CardBand>
        ) : (
          <DataTable
            label="Agent runs"
            testId="runs-index"
            grid={GRID}
            head={[
              { label: "Run" },
              { label: "Status", className: "hidden sm:block" },
              { label: "Stores", className: "text-right sm:text-left" },
              { label: "Tool calls", className: "hidden md:block" },
              { label: "Tokens", className: "hidden lg:block" },
              { label: "Cost", className: "hidden md:block" },
              { label: "Models", className: "hidden lg:block" },
            ]}
            footer={<span className="tnum">{runs.length} {runs.length === 1 ? "run" : "runs"} in this tab</span>}
          >
            {runs.map((r) => (
              <DataRow key={r.runId} grid={GRID} data-testid={`run-row-${r.runId}`} data-state={r.state} onClick={() => router.push(`/app/runs/${r.runId}`)}>
                <Cell>
                  <span className="block truncate">{runWhen(r.startedAt)}</span>
                  <span className="block truncate font-mono text-[12px] font-normal text-muted">{r.runId}</span>
                </Cell>
                <Cell className="hidden sm:block"><RunStateChip state={r.state} /></Cell>
                <Cell className="text-right tnum sm:text-left">{r.done}/{r.total}</Cell>
                <Cell className="hidden tnum md:block">{formatInt(r.toolCalls)}</Cell>
                <Cell className="hidden tnum lg:block">{formatInt(r.tokens)}</Cell>
                <Cell className="hidden tnum md:block">{usd(r.usd)}</Cell>
                <Cell className="hidden flex-wrap gap-1 lg:flex">{r.models.slice(0, 2).map((m) => <ModelChip key={m} model={m} dark={false} />)}{r.models.length > 2 ? <span className="self-center text-[12px] text-muted">+{r.models.length - 2}</span> : null}</Cell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </Band>
    </Page>
  );
}
