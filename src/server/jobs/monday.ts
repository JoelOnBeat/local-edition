import type { AgentEvent, JobRun } from "@/contract";
import { newId } from "@/lib/ids";
import { HttpError, UpstreamError } from "../http/errors";
import { createLogger } from "../log";
import { DEMO_WORKSPACE_ID, ensureDemoWorkspace } from "../session";
import type { Repo } from "../store";
import type { JobPorts } from "./ports";

const log = createLogger("jobs");

/** A run still marked `running` after this long is treated as dead and replaced. */
export const STALE_RUN_MS = 30 * 60 * 1000;

/** ISO date of the Monday (UTC) of the week containing `now`. */
export function mondayOf(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface StartJobOptions {
  repo: Repo;
  ports: JobPorts;
  trigger: JobRun["trigger"];
  storeIds?: string[];
  nebiusJobId?: string | null;
  now?: () => Date;
}

/**
 * Starts the weekly build for the canonical demo workspace and returns the `running` JobRun at once;
 * the build continues in the background (Workers `waitUntil`) and the caller polls /api/jobs/latest.
 * A fresh run already in flight is returned as is, so a retried or replayed request cannot double-spend.
 */
export async function startMondayJob(opts: StartJobOptions): Promise<JobRun> {
  const now = opts.now ?? (() => new Date());
  const { repo, ports } = opts;
  const demo = await ensureDemoWorkspace(repo);
  const all = await repo.listStores(demo.chainId);
  const stores = opts.storeIds ? all.filter((s) => opts.storeIds!.includes(s.id)) : all;
  if (opts.storeIds && stores.length !== new Set(opts.storeIds).size) {
    throw new HttpError(400, "unknown_store", "One or more store ids are not in the demo workspace.");
  }
  if (stores.length === 0) throw new HttpError(409, "no_stores", "The demo workspace has no stores to build.");

  const latest = await repo.latestJobRun();
  if (latest?.status === "running") {
    if (now().getTime() - Date.parse(latest.startedAt) < STALE_RUN_MS) return latest;
    await repo.putJobRun({ ...latest, status: "failed", finishedAt: now().toISOString(), note: "Timed out without finishing." });
  }

  const run: JobRun = {
    id: newId("job"),
    trigger: opts.trigger,
    startedAt: now().toISOString(),
    finishedAt: null,
    storeIds: stores.map((s) => s.id),
    status: "running",
    nebiusJobId: opts.nebiusJobId ?? null,
    note: `Building ${stores.length} store${stores.length === 1 ? "" : "s"}.`,
  };
  await repo.putJobRun(run);
  ports.background(
    executeJob(run, { repo, ports, now }).catch((e) => log.error("job crashed", { runId: run.id, err: e })),
  );
  return run;
}

function failureCode(e: unknown): string {
  if (e instanceof UpstreamError || e instanceof HttpError) return e.code;
  return "internal";
}

/** Drains the build's events and writes the final JobRun. Never throws; notes carry codes, not upstream text. */
export async function executeJob(run: JobRun, ctx: { repo: Repo; ports: JobPorts; now: () => Date }): Promise<JobRun> {
  const { repo, ports } = ctx;
  const editionIds: string[] = [];
  const errors: string[] = [];
  let finished = false;
  try {
    const demo = await ensureDemoWorkspace(repo);
    const chain = (await repo.getChain(demo.chainId))!;
    const stores = (await repo.listStores(demo.chainId)).filter((s) => run.storeIds.includes(s.id));
    const menu = await repo.listMenu(demo.chainId);
    const events = ports.buildEditions({
      repo, workspaceId: DEMO_WORKSPACE_ID, chain, stores, menu, weekOf: mondayOf(ctx.now()), runId: run.id,
    });
    for await (const event of events as AsyncIterable<AgentEvent>) {
      if (event.type === "run_done") { editionIds.push(...event.editionIds); finished = true; }
      else if (event.type === "error") errors.push(event.code);
    }
  } catch (e) {
    errors.push(failureCode(e));
  }
  const ok = finished && editionIds.length > 0;
  const note = ok
    ? `Built ${editionIds.length} of ${run.storeIds.length} editions${errors.length ? `; ${errors.length} error(s): ${[...new Set(errors)].join(", ")}` : ""}. Drafts await approval.`
    : `Build failed${errors.length ? ` (${[...new Set(errors)].join(", ")})` : ""}.`;
  const done: JobRun = { ...run, status: ok ? "done" : "failed", finishedAt: ctx.now().toISOString(), note };
  await repo.putJobRun(done);
  return done;
}
