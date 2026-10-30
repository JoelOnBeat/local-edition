import { z } from "zod";

/**
 * Tolerant (loose) schemas for the documented Qloo envelopes. Every field is optional because
 * the hackathon host has not been observed yet (docs/briefs: "shapes are as documented, not as
 * observed"); unknown fields pass through. A body that is not an object, or whose lists hold
 * non-objects, fails as `invalid_response`.
 */

const num = z.number();

export const QlooTag = z.looseObject({
  id: z.string().optional(),
  tag_id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  types: z.array(z.string()).optional(),
  subtype: z.string().optional(),
  popularity: num.optional(),
  query: z.looseObject({ affinity: num.optional(), score: num.optional() }).optional(),
});
export type QlooTag = z.infer<typeof QlooTag>;

export const QlooEntity = z.looseObject({
  entity_id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  subtype: z.string().optional(),
  /** /search and /entities rows: `["urn:entity:brand"]` (insights rows use `type` + `subtype`). */
  types: z.array(z.string()).optional(),
  popularity: num.optional(),
  tags: z.array(QlooTag).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  location: z.unknown().optional(),
  external: z.unknown().optional(),
  query: z.looseObject({ affinity: num.optional(), explainability: z.unknown().optional() }).optional(),
});
export type QlooEntity = z.infer<typeof QlooEntity>;

export const HeatCell = z.looseObject({
  location: z.looseObject({ latitude: num.optional(), longitude: num.optional(), geohash: z.string().optional() }).optional(),
  query: z.looseObject({ affinity: num.optional(), affinity_rank: num.optional(), popularity: num.optional() }).optional(),
});
export type HeatCell = z.infer<typeof HeatCell>;

const Results = z.looseObject({
  entities: z.array(QlooEntity).optional(),
  tags: z.array(QlooTag).optional(),
  audiences: z.array(z.looseObject({})).optional(),
  heatmap: z.array(HeatCell).optional(),
  demographics: z.array(z.unknown()).optional(),
  trending: z.array(z.unknown()).optional(),
});

const base = { success: z.boolean().optional(), duration: num.optional() };

/** /search and /entities: a bare array of entities, or `{ entities }`. */
export const SearchEnvelope = z.looseObject({ ...base, results: z.union([z.array(QlooEntity), Results]).optional() });
export const InsightsEnvelope = z.looseObject({ ...base, results: z.union([Results, z.array(z.unknown())]).optional() });
export const TagsEnvelope = InsightsEnvelope;
export const AudiencesEnvelope = InsightsEnvelope;
/** compare returns tags per the recipe; the OpenAPI describes entity variants, so accept either. */
export const CompareEnvelope = z.looseObject({ ...base, results: z.union([z.array(z.unknown()), Results]).optional() });
export const TrendingEnvelope = z.looseObject({ ...base, results: z.union([z.array(z.unknown()), Results]).optional() });

export type SearchEnvelope = z.infer<typeof SearchEnvelope>;
export type InsightsEnvelope = z.infer<typeof InsightsEnvelope>;
export type CompareEnvelope = z.infer<typeof CompareEnvelope>;
export type TrendingEnvelope = z.infer<typeof TrendingEnvelope>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isEntityId = (s: string) => UUID_RE.test(s);
