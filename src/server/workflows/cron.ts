import { createLogger } from "../log";
import type { PlatformEnv } from "../platform/env";
import { DEMO_WORKSPACE_ID } from "../session";
import { createD1Repo } from "../store/d1";
import { BuildWorkflowParams } from "./types";

const log = createLogger("cron");

/** `0 0 * * MON` on Cloudflare (weekday names; numbers start on Sunday there): Monday 00:00 UTC = 08:00 in Kuala Lumpur. */
export const WEEKLY_CRON = "0 0 * * MON";

/** One id per calendar day of the trigger: a retried or duplicated cron event cannot start a second rebuild. */
export const weeklyRunId = (scheduledTime: number): string => `weekly-${new Date(scheduledTime).toISOString().slice(0, 10)}`;

/**
 * The Worker's `scheduled()` body: start WeeklyRebuild for the demo workspace and delete expired rows.
 * Never throws (a failing cron is retried by nothing, so it logs and returns what it did).
 */
export async function handleScheduled(env: PlatformEnv, scheduledTime: number): Promise<{ started: boolean; purged: number }> {
  let started = false;
  let purged = 0;
  const runId = weeklyRunId(scheduledTime);
  try {
    if (!env.WEEKLY_REBUILD) throw new Error("WEEKLY_REBUILD workflow is not bound.");
    const params = BuildWorkflowParams.parse({ runId, workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" });
    await env.WEEKLY_REBUILD.create({ id: runId, params });
    started = true;
  } catch (e) {
    // Creating the same id twice means this trigger already started it, which is the desired outcome.
    if (/already|exists|duplicate/i.test(String((e as Error)?.message))) started = true;
    else log.error("could not start WeeklyRebuild", { runId, err: e });
  }
  try {
    const db = env.LE_DB;
    if (db) purged = await createD1Repo(async () => db).purgeExpired();
  } catch (e) {
    log.error("purge failed", { err: e });
  }
  return { started, purged };
}
