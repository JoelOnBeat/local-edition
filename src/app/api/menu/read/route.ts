import { MENU_READ_LIMITS } from "@/server/limits-table";
import { routes } from "@/contract";
import { wsRoute } from "@/server/handlers/ws";
import { ipLimited, rateLimit } from "@/server/limits";
import { requireMenuImage } from "@/server/tokenfactory/image";
import { readMenuBoardDetailed } from "@/server/tokenfactory/menu";
import { stashPhoto } from "@/server/tokenfactory/menu-photo";
import { RetryAfterError } from "@/server/http/errors";
import { MODEL_UNAVAILABLE } from "@/server/http/model-unavailable";
import { recordModelSkip } from "@/server/agent/stats";
import { getRepo } from "@/server/store";

/**
 * POST /api/menu/read: multipart `image` (jpg/png/webp, <= 5 MB, checked by the contract schema and again
 * by magic bytes) -> MenuItem[]. The photo is kept in blob storage, read by Super VL, then checked row by row
 * against the same photo: rows the model cannot find on the board are dropped, unreadable prices come back with
 * `priceLegible: false`. Header `x-le-mode` tells the UI whether the read was live, replayed or sample;
 * `x-le-verify` says whether the check ran (`verified`) or was skipped (`skipped`).
 * When the vision model is unavailable on Token Factory the route answers 503 `{ error, code: "model_unavailable" }` with `Retry-After`.
 * This is the dearest call in the app (a vision model), so it needs the workspace cookie, is rate limited per
 * IP (before the upload is read) and per workspace, and its spend is reserved against the shared cap.
 */
const read = wsRoute(routes.readMenu, async ({ body }, { workspace }) => {
  await rateLimit({ key: `menu-read:ws:${workspace.id}`, ...MENU_READ_LIMITS.workspace });
  const bytes = new Uint8Array(await body.image.arrayBuffer());
  const mime = requireMenuImage(bytes);
  await stashPhoto(workspace.id, bytes, mime);
  const { items, mode, verify } = await readMenuBoardDetailed(bytes, mime).catch(async (e: unknown) => {
    // Super VL is gone: the answer is `{ error, code: "model_unavailable" }` with a Retry-After hint, and /proof's step says so.
    if (e instanceof RetryAfterError && e.code === MODEL_UNAVAILABLE) await recordModelSkip(await getRepo(), "vision", e.message);
    throw e;
  });
  return Response.json(routes.readMenu.response.parse(items), {
    headers: { "cache-control": "no-store", "x-le-mode": mode, "x-le-verify": verify },
  });
});

export const POST = ipLimited({ name: "menu-read", ...MENU_READ_LIMITS.ip }, read);
