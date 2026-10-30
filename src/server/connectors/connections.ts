import { getConnectionsSpec, type ConnectionsResponse } from "@/contract";
import { mergeConnections } from "@/lib/connections";
import { createLogger } from "../log";
import { wsRoute } from "../handlers/ws";
import { listFeeds } from "./calendar/feeds";
import { buildCommsState } from "./comms/state";
import { liveCommsDeps, type CommsDeps } from "./comms/deps";
import { squareDeps, type SquareDeps } from "./square/deps";
import { squareStatus } from "./square/connect";

const log = createLogger("connections");

const attempt = async <T>(lane: string, run: () => Promise<T>): Promise<T | null> => {
  try {
    return await run();
  } catch (e) {
    log.warn("connection lane unreadable", { lane, err: e });
    return null;
  }
};

/**
 * GET /api/connections: Square, Slack, Gmail, Outlook and a calendar row derived from the approved event nights, with every lane's
 * sync events newest first. A lane that cannot be read drops out of the answer instead of failing it.
 */
export async function buildConnections(square: SquareDeps, comms: CommsDeps, workspaceId: string): Promise<ConnectionsResponse> {
  const [sq, cm, feeds, ledgerEvents] = await Promise.all([
    attempt("square", () => squareStatus(square, workspaceId)),
    attempt("comms", () => buildCommsState(comms, workspaceId)),
    attempt("calendar", () => listFeeds({ ledger: square.ledger, repo: square.repo, appUrl: square.config.appUrl }, workspaceId)),
    attempt("ledger-events", () => square.ledger.listEvents(workspaceId, null, 50)),
  ]);
  return mergeConnections({
    square: sq?.connection ?? null,
    comms: cm?.connections ?? [],
    feeds: feeds ?? [],
    events: [sq?.events ?? [], cm?.events ?? [], ledgerEvents ?? []],
  });
}

export const getConnections = wsRoute(getConnectionsSpec, async (_in, ctx) =>
  buildConnections(await squareDeps({ repo: ctx.repo }), { ...(await liveCommsDeps()), repo: ctx.repo }, ctx.workspace.id),
);
