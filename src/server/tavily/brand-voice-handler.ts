import { BRAND_VOICE_LIMITS } from "../limits-table";
import { routes } from "@/contract";
import { HttpError } from "../http/errors";
import { requireChain, wsRoute } from "../handlers/ws";
import { rateLimit } from "../limits";
import { BrandVoiceBody, generateBrandVoice } from "./brand-voice";

/**
 * POST /api/chain/brand-voice: body `{ url }` (the chain's own public site) -> `{ lines, sources }`.
 * The contract's request schema is `{}`, which passes any JSON object, so the url is read and validated
 * here from the raw body (a contract change would make it a typed field). A saved result is served again
 * without a crawl. Spends Tavily credits and a Lightning call, so it needs the workspace cookie and is
 * rate limited per workspace on top of the per-IP limit in route.ts.
 */
export const brandVoicePost = wsRoute(routes.generateBrandVoice, async (_input, ctx) => {
  await rateLimit({ key: `brand-voice:ws:${ctx.workspace.id}`, ...BRAND_VOICE_LIMITS.workspace });
  let parsedBody: unknown;
  try {
    parsedBody = ctx.rawBody ? JSON.parse(ctx.rawBody) : {};
  } catch {
    throw new HttpError(400, "invalid_input", "The request body is not valid JSON.");
  }
  const body = BrandVoiceBody.safeParse(parsedBody);
  if (!body.success) throw new HttpError(400, "invalid_input", "Send the chain's website as { \"url\": \"https://...\" }.");

  const chain = await requireChain(ctx);
  const { lines, sources, cached } = await generateBrandVoice(chain, body.data.url, { workspaceId: ctx.workspace.id });
  return Response.json(routes.generateBrandVoice.response.parse({ lines, sources }), {
    headers: { "cache-control": "no-store", "x-le-cache": cached ? "saved" : "fresh" },
  });
});
