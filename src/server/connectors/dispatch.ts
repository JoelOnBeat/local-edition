import { createLogger } from "../log";

const log = createLogger("connectors:dispatch");

/**
 * The post-approval dispatcher. When an edition becomes approved (the app's approve-all, the last item approved, or the Slack Approve
 * button), every registered connector gets one call and carries the approved edition to where the chain works: the staff card to the
 * store's Slack channel and the manager's mailbox (lane B3), the special to Square (lane B2).
 *
 * Dispatchers are independent: one failing never stops another, and none may throw into the caller. Each must be idempotent (claim a key
 * per edition before it sends), because an edition can reach `approved` more than once and Slack and the app can approve at the same time.
 */

export interface ApprovedEdition {
  workspaceId: string;
  editionId: string;
}

export type Dispatcher = (approved: ApprovedEdition) => Promise<void>;

/** Connector lanes list themselves here; modules load lazily so a Worker only pays for what it dispatches to. */
const LOADERS: Record<string, () => Promise<Dispatcher>> = {
  slack: async () => (await import("./slack/dispatch")).dispatchSlack,
  mail: async () => (await import("./mail/dispatch")).dispatchMail,
  square: async () => (await import("./square/dispatch")).dispatchSquare,
};

const extra = new Map<string, Dispatcher>();

/** For lanes and tests that register a dispatcher at runtime. */
export function registerDispatcher(name: string, fn: Dispatcher): void {
  extra.set(name, fn);
}

export interface DispatchResult {
  name: string;
  ok: boolean;
}

export async function dispatchApproved(approved: ApprovedEdition): Promise<DispatchResult[]> {
  const jobs: [string, () => Promise<Dispatcher>][] = [
    ...Object.entries(LOADERS),
    ...[...extra.entries()].map(([name, fn]): [string, () => Promise<Dispatcher>] => [name, async () => fn]),
  ];
  return Promise.all(
    jobs.map(async ([name, load]) => {
      try {
        await (await load())(approved);
        return { name, ok: true };
      } catch (e) {
        log.error("dispatcher failed", { dispatcher: name, editionId: approved.editionId, err: e });
        return { name, ok: false };
      }
    }),
  );
}
