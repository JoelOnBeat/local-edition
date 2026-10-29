import { routes } from "@/contract";
import { withRoute } from "@/server/http/api";
import { requireMenuImage } from "@/server/tokenfactory/image";
import { readMenuBoardDetailed } from "@/server/tokenfactory/menu";

/**
 * POST /api/menu/read: multipart `image` (jpg/png/webp, <= 5 MB, checked by the contract schema and again
 * by magic bytes) -> MenuItem[]. Header `x-le-mode` tells the UI whether the read was live, replayed or sample.
 */
export const POST = withRoute(routes.readMenu, async ({ body }) => {
  const bytes = new Uint8Array(await body.image.arrayBuffer());
  const mime = requireMenuImage(bytes);
  const { items, mode } = await readMenuBoardDetailed(bytes, mime);
  return Response.json(routes.readMenu.response.parse(items), {
    headers: { "cache-control": "no-store", "x-le-mode": mode },
  });
});
