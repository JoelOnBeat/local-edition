import { routes } from "@/contract";
import { wsRoute } from "@/server/handlers/ws";
import { ipLimited, rateLimit } from "@/server/limits";
import { requireMenuImage } from "@/server/tokenfactory/image";
import { readMenuBoardDetailed } from "@/server/tokenfactory/menu";

/**
 * POST /api/menu/read: multipart `image` (jpg/png/webp, <= 5 MB, checked by the contract schema and again
 * by magic bytes) -> MenuItem[]. Header `x-le-mode` tells the UI whether the read was live, replayed or sample.
 * This is the dearest call in the app (a vision model), so it needs the workspace cookie, is rate limited per
 * IP (before the upload is read) and per workspace, and its spend is reserved against the shared cap.
 */
const read = wsRoute(routes.readMenu, async ({ body }, { workspace }) => {
  await rateLimit({ key: `menu-read:ws:${workspace.id}`, capacity: 6, refillPerMinute: 3 });
  const bytes = new Uint8Array(await body.image.arrayBuffer());
  const mime = requireMenuImage(bytes);
  const { items, mode } = await readMenuBoardDetailed(bytes, mime);
  return Response.json(routes.readMenu.response.parse(items), {
    headers: { "cache-control": "no-store", "x-le-mode": mode },
  });
});

export const POST = ipLimited({ name: "menu-read", capacity: 12, refillPerMinute: 6 }, read);
