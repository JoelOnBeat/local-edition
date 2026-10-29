import type { ProviderMode } from "@/contract";
import { serverEnv, type ServerEnv } from "@/lib/env";
import type { ProviderRunMode } from "../http/fetch-json";
import type { Recorder } from "../http/recorder";
import type { TokenFactory } from "../tokenfactory/client";
import { createLedger, type CreditLedger } from "./budget";
import { repoCache, type TavilyCache } from "./cache";
import { tavilyModeFor } from "./mode";

/** Options every Tavily entry point takes. Tests pass their own seams; production passes `workspaceId` and `city`. */
export interface TavilyOptions {
  /** Defaults to the parsed server env. Tests pass their own. */
  env?: Pick<ServerEnv, "TAVILY_MODE" | "TAVILY_API_KEY">;
  recorder?: Recorder;
  /** The chain's city, added to the query so it searches the right town. */
  city?: string;
  /** Whose daily credit allowance a live call draws on. */
  workspaceId?: string;
  /** Result cache, used in live mode only (recordings are the cache elsewhere). Defaults to the repo cache. */
  cache?: TavilyCache;
  ledger?: CreditLedger;
  /** Lightning, for the triage and brand-voice calls. Defaults to the shared Token Factory client. */
  tf?: TokenFactory;
  /** Read saved results only; never spend a credit. Regenerate and page loads set this. */
  cacheOnly?: boolean;
  // Test seams, passed through to fetchJson.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  clock?: () => Date;
}

export interface TavilyRuntime {
  run: ProviderRunMode;
  status: ProviderMode;
  apiKey?: string;
  clock: () => Date;
  workspaceId: string;
  cacheOnly: boolean;
  /** Present only for live runs: replay and fixture runs cost nothing and need no cache. */
  cache: TavilyCache | null;
  ledger: CreditLedger | null;
  http: Pick<TavilyOptions, "recorder" | "fetchImpl" | "sleep" | "random">;
}

export async function resolveRuntime(opts: TavilyOptions): Promise<TavilyRuntime> {
  const env = opts.env ?? serverEnv();
  const { run, status } = tavilyModeFor(env);
  const clock = opts.clock ?? (() => new Date());
  const live = run === "live";
  const cache = live ? (opts.cache ?? (await repoCache())) : null;
  const ledger = live ? (opts.ledger ?? createLedger(cache!, clock)) : null;
  return {
    run,
    status,
    apiKey: live ? env.TAVILY_API_KEY : undefined,
    clock,
    workspaceId: opts.workspaceId ?? "shared",
    cacheOnly: opts.cacheOnly ?? false,
    cache,
    ledger,
    http: { recorder: opts.recorder, fetchImpl: opts.fetchImpl, sleep: opts.sleep, random: opts.random },
  };
}
