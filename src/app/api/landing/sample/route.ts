import { landingSample } from "@/server/landing/sample";

export const dynamic = "force-dynamic";

/**
 * GET /api/landing/sample: a public, read-only view of the canonical demo workspace (this week's sample editions and their Qloo taste tags),
 * saved in KV for ten minutes. It reads saved answers only and never calls Qloo. 503 `sample_unavailable` when nothing live is built yet.
 */
export async function GET(): Promise<Response> {
  const sample = await landingSample();
  if (!sample) return Response.json({ error: "This week's sample editions are not available yet. Try again shortly.", code: "sample_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  return Response.json(sample, { headers: { "cache-control": "public, max-age=60" } });
}
