import type { AgentDeps } from "../../agent/ports";
import { getRepo, type Repo } from "../../store";
import { commsEnv, type CommsEnv } from "./env";
import { getCommsStore, type CommsStore } from "./store";

/** Everything the Slack and mail modules need, injectable so tests run on fakes and never touch the network. */
export interface CommsDeps {
  store: CommsStore;
  env: CommsEnv;
  repo: Repo;
  fetchImpl?: typeof fetch;
  now: () => Date;
  /** The edition agent's wiring: staff-card writing, regenerate, and the Nemotron chat used by the reply classifier. */
  agent: () => Promise<AgentDeps>;
  /** The post-approval dispatcher (Slack card, mail, Square). Injectable so tests can run it on the same fakes. */
  dispatch: (approved: { workspaceId: string; editionId: string }) => Promise<void>;
}

export async function liveCommsDeps(): Promise<CommsDeps> {
  return {
    store: await getCommsStore(),
    env: commsEnv(),
    repo: await getRepo(),
    now: () => new Date(),
    agent: async () => (await import("../../agent/deps")).getAgentDeps(),
    dispatch: async (approved) => { await (await import("../dispatch")).dispatchApproved(approved); },
  };
}

/** Sample workspaces share one Slack workspace and one test mailbox, so their sends are capped per day (visitors cannot flood them). */
export const SAMPLE_DAILY_LIMIT = { slack: 40, mail: 20 } as const;

export async function takeSampleQuota(deps: CommsDeps, kind: keyof typeof SAMPLE_DAILY_LIMIT): Promise<boolean> {
  const day = deps.now().toISOString().slice(0, 10);
  for (let n = 1; n <= SAMPLE_DAILY_LIMIT[kind]; n++) {
    if (await deps.store.claim(`sample-quota:${kind}:${day}:${n}`, deps.now().getTime())) return true;
  }
  return false;
}
