"use client";

import { useRouter } from "next/navigation";
import { ButtonLink, CardBand, EmptyState, Pill } from "../ui";
import { Cell, DataRow, DataTable } from "../app-ui/data-table";
import { Band, Gap, Page, PageHeader } from "../app-ui/frame";
import { Icon } from "../app-ui/icons";
import { formatInt } from "../lib/format";
import { RunStateChip } from "./last-run-card";
import { runWhen, useRunSummaries } from "./run-summary";
import { ModelChip, usd } from "./trace-entry";

const GRID =
  "grid-cols-[minmax(0,1fr)_64px] sm:grid-cols-[minmax(0,1fr)_110px_72px] md:grid-cols-[minmax(0,1fr)_110px_72px_84px_80px] " +
  "lg:grid-cols-[minmax(0,1fr)_110px_72px_84px_84px_80px_minmax(0,1fr)]";

/** /app/runs: the workspace's runs from the server's run log, newest first, merged with the traces this tab holds. Opening one replays its trace from the server. */
export function RunsIndex() {
  const router = useRouter();
  const { runs, ready, failed } = useRunSummaries();

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/app", label: "Portfolio" }, { label: "Agent runs" }]}
        pill={<Pill icon={<Icon name="terminal" />}>Agent runs</Pill>}
        title="Agent runs"
        lede="Every build of this workspace, whichever tab or schedule started it: status, stores done, cost and when it ran. Open one to replay its trace from the server."
      />
      <Gap />
      <Band grow>
        {runs.length === 0 ? (
          <CardBand title="Runs" icon={<Icon name="terminal" />} flush className="flex-1" bodyClassName="flex flex-1 items-center justify-center min-h-[360px]">
            <EmptyState
              icon={<Icon name="terminal" size={20} />}
              title={!ready ? "Loading runs" : failed ? "The run log could not be read" : "No run in this workspace yet"}
              body={failed ? "Reload the page to try again. Runs started in this tab are still listed when they exist." : "Build this week's editions from the portfolio to watch the agent work. Every build is kept here, and its trace replays in any tab."}
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
            footer={<span className="tnum">{runs.length} {runs.length === 1 ? "run" : "runs"} in this workspace</span>}
          >
            {runs.map((r) => (
              <DataRow key={r.runId} grid={GRID} data-testid={`run-row-${r.runId}`} data-state={r.state} onClick={() => router.push(`/app/runs/${r.runId}`)}>
                <Cell>
                  <span className="block truncate">{runWhen(r.startedAt)}</span>
                  <span className="block truncate font-mono text-[12px] font-normal text-muted">{r.runId}</span>
                  <span className="mt-1 block sm:hidden"><RunStateChip state={r.state} /></span>
                </Cell>
                <Cell className="hidden sm:block"><RunStateChip state={r.state} /></Cell>
                <Cell className="text-right tnum sm:text-left">{r.done}/{r.total}</Cell>
                <Cell className="hidden tnum md:block">{r.toolCalls === null ? "–" : formatInt(r.toolCalls)}</Cell>
                <Cell className="hidden tnum lg:block">{r.tokens === null ? "–" : formatInt(r.tokens)}</Cell>
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
