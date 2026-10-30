import { squareRoutes } from "@/contract";
import { withRoute } from "../../http/api";
import { apiError } from "../../http/api";
import { HttpError } from "../../http/errors";
import { wsRoute } from "../../handlers/ws";
import { getRepo } from "../../store";
import { readSquareConfig } from "../square/config";
import { getLedger } from "../ledger";
import { listFeeds, renderFeed, resolveFeed } from "./feeds";

const deps = async () => ({ ledger: await getLedger(), repo: await getRepo(), appUrl: readSquareConfig().appUrl });

export const getCalendarFeeds = wsRoute(squareRoutes.getCalendarFeeds, async (_in, ctx) => ({
  feeds: await listFeeds({ ...(await deps()), repo: ctx.repo }, ctx.workspace.id),
}));

/** Public: the token in the URL is the capability. Anything wrong with it is the same plain 404. */
export const getCalendarIcs = withRoute(squareRoutes.getCalendarIcs, async ({ params }) => {
  try {
    const d = await deps();
    const text = await renderFeed(d, await resolveFeed(d, params.token));
    return new Response(text, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="local-edition-events.ics"',
        "cache-control": "private, max-age=300",
        "x-robots-tag": "noindex",
      },
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return apiError(404, "not_found", "This calendar link is not valid.");
    throw e;
  }
});
