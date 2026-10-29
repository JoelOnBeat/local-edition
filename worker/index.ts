/* eslint-disable @typescript-eslint/ban-ts-comment -- the OpenNext worker only exists after its build, so a missing-module error is expected before it */
/**
 * The Worker entry (wrangler `main`). It is OpenNext's generated worker plus what OpenNext cannot emit:
 * the Durable Object classes, the Workflow classes and the cron handler. `fetch` is OpenNext's, untouched.
 * Build order: `opennextjs-cloudflare build` writes .open-next/worker.js, then wrangler bundles this file.
 */
// @ts-ignore: .open-next/worker.js exists only after `opennextjs-cloudflare build`.
import openNext from "../.open-next/worker.js";
// @ts-ignore: same file; OpenNext's own Durable Objects (queue, tag cache), re-exported so a binding can find them.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";
export { BuildLockDO, SpendMeterDO, TavilyBudgetDO } from "../src/server/platform/durable-objects";
export { EditionBuild, WeeklyRebuild } from "./workflows";
import { applyEnvToProcess, setPlatformEnv, type PlatformEnv } from "../src/server/platform/env";
import { handleScheduled } from "../src/server/workflows/cron";

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const worker = {
  fetch(request: Request, env: PlatformEnv, ctx: ExecutionContextLike): Promise<Response> {
    setPlatformEnv(env);
    return (openNext as { fetch(r: Request, e: PlatformEnv, c: ExecutionContextLike): Promise<Response> }).fetch(request, env, ctx);
  },

  /** Cron `0 0 * * MON`: start WeeklyRebuild and purge expired rows. */
  async scheduled(controller: { scheduledTime: number }, env: PlatformEnv, ctx: ExecutionContextLike): Promise<void> {
    setPlatformEnv(env);
    applyEnvToProcess(env);
    ctx.waitUntil(handleScheduled(env, controller.scheduledTime));
  },
};

export default worker;
