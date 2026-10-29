import type { QlooEntityRef } from "@/contract";
import type { LatLon } from "./geo";
import type { HeatCell, QlooEntity, QlooTag } from "./types";

/** Defensive extractors over the loose envelopes. Nothing here throws on odd shapes. */

type Env = { results?: unknown } | undefined;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function listFrom<T>(env: Env, key: string): T[] {
  const r = env?.results;
  if (isObj(r) && Array.isArray(r[key])) return r[key] as T[];
  return [];
}

export function entitiesOf(env: Env): QlooEntity[] {
  const r = env?.results;
  if (Array.isArray(r)) return r.filter(isObj) as QlooEntity[];
  return listFrom<QlooEntity>(env, "entities");
}
export const tagsOf = (env: Env): QlooTag[] => listFrom<QlooTag>(env, "tags");
export const heatCellsOf = (env: Env): HeatCell[] => listFrom<HeatCell>(env, "heatmap");

export const tagIdOf = (t: QlooTag): string | undefined => t.tag_id ?? t.id;
export const affinityOf = (e: { query?: { affinity?: number } }): number | undefined => e.query?.affinity;

/** Namespace of a tag urn, e.g. `urn:tag:cuisine:qloo:italian` -> `cuisine`. */
export function tagNamespace(tagId: string): string {
  return tagId.split(":")[2] ?? "other";
}

export function entityRef(e: QlooEntity, fallbackType: string): QlooEntityRef | undefined {
  if (!e.entity_id || !e.name) return undefined;
  const sub = e.subtype?.startsWith("urn:entity:") ? e.subtype : undefined;
  const type = sub ?? (e.type?.startsWith("urn:entity:") && e.type !== "urn:entity" ? e.type : fallbackType);
  return { entityId: e.entity_id, name: e.name, type };
}

function pair(o: unknown): LatLon | undefined {
  if (!isObj(o)) return undefined;
  const lat = o.lat ?? o.latitude;
  const lon = o.lon ?? o.lng ?? o.longitude;
  return isNum(lat) && isNum(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
}

/** Coordinates are not observed yet: try the documented spots (`properties.geocode`) and common ones. */
export function latLonOf(e: QlooEntity): LatLon | undefined {
  const p = e.properties;
  const geo = isObj(p?.geocode) ? p.geocode : undefined;
  const candidates = [e.location, geo, geo?.location, p?.location, p?.coordinates, p?.geo];
  for (const c of candidates) {
    const direct = pair(c);
    if (direct) return direct;
  }
  return undefined;
}

export function addressOf(e: QlooEntity): string | null {
  const p = e.properties;
  const a = p?.address;
  if (typeof a === "string" && a.trim()) return a.trim();
  const geo = isObj(p?.geocode) ? p.geocode : undefined;
  const name = geo?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export function ratingOf(e: QlooEntity): number | null {
  const r = e.properties?.business_rating;
  return isNum(r) ? r : null;
}

export function imageOf(e: QlooEntity): string | null {
  const img = e.properties?.image;
  return isObj(img) && typeof img.url === "string" ? img.url : null;
}

export function spotifyIdOf(e: QlooEntity): string | null {
  const ext = isObj(e.external) ? e.external : undefined;
  const sp = ext && isObj(ext.spotify) ? ext.spotify : undefined;
  const id = sp?.id;
  if (typeof id === "string") return id;
  if (Array.isArray(id) && typeof id[0] === "string") return id[0];
  return null;
}

/**
 * `query.explainability` is documented as "which input entities contributed (normalised 0-1)".
 * Tolerates an array, `{ entities: [...] }`, or an id -> weight map; returns the top contributor.
 */
export function topContributor(expl: unknown, names: Map<string, string>): string | null {
  const entries: { id?: string; name?: string; w: number }[] = [];
  const add = (v: unknown, keyId?: string) => {
    if (isNum(v) && keyId) entries.push({ id: keyId, w: v });
    else if (isObj(v)) {
      const w = [v.weight, v.impact, v.score, v.contribution].find(isNum);
      const id = typeof v.entity_id === "string" ? v.entity_id : keyId;
      if (w !== undefined) entries.push({ id, name: typeof v.name === "string" ? v.name : undefined, w });
    }
  };
  if (Array.isArray(expl)) expl.forEach((v) => add(v));
  else if (isObj(expl)) {
    if (Array.isArray(expl.entities)) expl.entities.forEach((v) => add(v));
    else Object.entries(expl).forEach(([k, v]) => add(v, k));
  }
  entries.sort((a, b) => b.w - a.w);
  const top = entries[0];
  return top ? (top.name ?? (top.id ? names.get(top.id) : undefined) ?? null) : null;
}

export interface TrendPoint {
  date: string;
  populationPercentile?: number;
  populationRank?: number;
  rankVelocity?: number;
  velocityFoldChange?: number;
  percentDelta?: number;
}

function toPoint(o: Record<string, unknown>): TrendPoint | undefined {
  if (typeof o.date !== "string") return undefined;
  const n = (v: unknown) => (isNum(v) ? v : undefined);
  return {
    date: o.date,
    populationPercentile: n(o.population_percentile),
    populationRank: n(o.population_rank),
    rankVelocity: n(o.population_rank_velocity),
    velocityFoldChange: n(o.velocity_fold_change),
    percentDelta: n(o.population_percent_delta),
  };
}

const SERIES_KEYS = ["trends", "series", "data", "history", "weeks", "points"];

/**
 * /v2/trending is a weekly series per entity (OpenAPI) but the exact nesting is unobserved.
 * Accepts `results[]` or `results.trending[]` whose items are either `{ entity_id, <series>: [...] }`
 * or flat points `{ entity_id?, date, ... }`. Points are returned newest first per entity.
 * `onlyEntityId` attributes id-less points when exactly one entity was requested.
 */
export function trendSeriesOf(env: Env, onlyEntityId?: string): Map<string, TrendPoint[]> {
  const r = env?.results;
  const items: unknown[] = Array.isArray(r) ? r : isObj(r) && Array.isArray(r.trending) ? r.trending : [];
  const out = new Map<string, TrendPoint[]>();
  const push = (id: string | undefined, p: TrendPoint | undefined) => {
    const key = id ?? onlyEntityId;
    if (!key || !p) return;
    out.set(key, [...(out.get(key) ?? []), p]);
  };
  for (const it of items) {
    if (!isObj(it)) continue;
    const id = typeof it.entity_id === "string" ? it.entity_id : undefined;
    const seriesKey = SERIES_KEYS.find((k) => Array.isArray(it[k]));
    if (seriesKey) (it[seriesKey] as unknown[]).forEach((p) => isObj(p) && push(id, toPoint(p)));
    else push(id, toPoint(it));
  }
  for (const [k, pts] of out) out.set(k, pts.sort((a, b) => b.date.localeCompare(a.date)));
  return out;
}

export interface SharedTag {
  tagId: string | null;
  name: string;
  score: number | null;
}

/** compare results: tags with `query.score` (recipe); entity variants are read by name/score too. */
export function compareTagsOf(env: Env): SharedTag[] {
  const r = env?.results;
  const items: unknown[] = Array.isArray(r) ? r : isObj(r) ? [...(Array.isArray(r.tags) ? r.tags : []), ...(Array.isArray(r.entities) ? r.entities : [])] : [];
  const out: SharedTag[] = [];
  for (const it of items) {
    if (!isObj(it) || typeof it.name !== "string") continue;
    const q = isObj(it.query) ? it.query : undefined;
    const score = [q?.score, q?.affinity].find(isNum) ?? null;
    const tagId = typeof it.tag_id === "string" ? it.tag_id : typeof it.id === "string" ? it.id : null;
    out.push({ tagId, name: it.name, score });
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
