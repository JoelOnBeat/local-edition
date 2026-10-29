import { PLACE_GENRES, PLACE_GENRE_PREFIX, TAG_TYPES, fakeUuid } from "../../../../fixtures/qloo";
import { clamp, round } from "../geo";
import { entityIndex, list, noise, num, type Json } from "./context";

/** Fixtures for /search, /entities, /v2/tags, /v2/audiences, /v2/analysis/compare and /v2/trending. */

const take = (p: Record<string, string>, dflt = 20) => Math.round(clamp(num(p.take) ?? dflt, 1, 50));

export function search(p: Record<string, string>): Json {
  const q = (p.query ?? "").trim().toLowerCase();
  const types = list(p.types);
  const kinds = new Set(types.map((t) => t.replace("urn:entity:", "")));
  const pool = [...entityIndex().values()].filter((e) => (kinds.size ? kinds.has(e.kind) : e.kind !== "place"));
  const rows = pool
    .filter((e) => !q || e.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || b.popularity - a.popularity);
  return { success: true, results: rows.slice(0, take(p, 10)).map((e) => e.entity), duration: 9 };
}

export function entities(p: Record<string, string>): Json {
  const index = entityIndex();
  const rows = list(p.entity_ids).flatMap((id) => index.get(id)?.entity ?? []);
  return { success: true, results: rows, duration: 7 };
}

export function tagSearch(p: Record<string, string>): Json {
  const q = (p["filter.query"] ?? "").trim().toLowerCase();
  const rows = [
    ...TAG_TYPES.flatMap((t) => t.tags.map(([slug, name, pop]) => ({ id: `${t.type}:${slug}`, name, type: t.type, popularity: pop }))),
    ...Object.entries(PLACE_GENRES).map(([slug, name]) => ({ id: `${PLACE_GENRE_PREFIX}${slug}`, name, type: "urn:tag:genre:place", popularity: 0.4 })),
  ].filter((t) => !q || t.name.toLowerCase().includes(q) || t.id.includes(q));
  return { success: true, results: { tags: rows.slice(0, take(p)) }, duration: 8 };
}

const AUDIENCES: [string, string, string][] = [
  ["urn:audience:hobbies_and_interests:outdoors", "Outdoors", "urn:audience:hobbies_and_interests"],
  ["urn:audience:lifestyle_preferences_beliefs:sustainability", "Sustainability", "urn:audience:lifestyle_preferences_beliefs"],
  ["urn:audience:leisure:live_music", "Live music", "urn:audience:leisure"],
  ["urn:audience:life_stage:young_families", "Young families", "urn:audience:life_stage"],
  ["urn:audience:professional_area:creative_industries", "Creative industries", "urn:audience:professional_area"],
];

export function audiences(p: Record<string, string>): Json {
  const q = (p["filter.query"] ?? "").trim().toLowerCase();
  const rows = AUDIENCES.filter(([id, name]) => !q || name.toLowerCase().includes(q) || id.includes(q)).map(([id, name, parent]) => ({
    id, entity_id: fakeUuid(id), name, type: parent, parents: [{ type: parent }],
  }));
  return { success: true, results: { audiences: rows.slice(0, take(p)) }, duration: 6 };
}

/** Per the recipe: tags with a shared-tag score, no `success` key. Score = weakest side's mean affinity. */
export function compare(p: Record<string, string>): Json {
  const index = entityIndex();
  const side = (ids: string[]) => {
    const acc = new Map<string, { name: string; sum: number; n: number }>();
    for (const id of ids) {
      const e = index.get(id);
      if (!e) continue;
      for (const t of ((e.entity.tags as { id: string; name: string }[] | undefined) ?? [])) {
        const cur = acc.get(t.id) ?? { name: t.name, sum: 0, n: 0 };
        acc.set(t.id, { ...cur, sum: cur.sum + e.affinity, n: cur.n + 1 });
      }
    }
    return acc;
  };
  const a = side(list(p["a.signal.interests.entities"]));
  const b = side(list(p["b.signal.interests.entities"]));
  const rows = [...a.entries()].flatMap(([id, x]) => {
    const y = b.get(id);
    return y ? [{ tag_id: id, name: x.name, types: [id.split(":").slice(0, -1).join(":")], query: { score: round(Math.min(x.sum / x.n, y.sum / y.n) * 0.85) } }] : [];
  });
  rows.sort((x, y) => y.query.score - x.query.score || x.tag_id.localeCompare(y.tag_id));
  return { duration: 31, results: rows.slice(0, take(p)) };
}

/** Weekly series per entity, newest first; fold change follows the entity's synthetic trend. */
export function trending(p: Record<string, string>): Json {
  const index = entityIndex();
  const end = new Date(`${p["filter.end_date"] ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const weeks = 12;
  const rows = list(p["signal.interests.entities"]).flatMap((id) => {
    const e = index.get(id);
    if (!e) return [];
    const series = Array.from({ length: weeks }, (_, w) => {
      const date = new Date(end.getTime() - w * 7 * 86_400_000).toISOString().slice(0, 10);
      const recent = Math.max(0, 1 - w / weeks);
      const fold = 1 + e.trend * 1.8 * recent + noise(id, String(w)) * 0.05;
      return {
        date,
        population_percentile: round(clamp(e.popularity + e.trend * 0.1 * recent, 0, 1)),
        population_rank: Math.round(2000 * (1 - e.popularity) + 40 * w),
        population_rank_velocity: Math.round(e.trend * 60 * recent),
        velocity_fold_change: round(fold, 2),
        population_percent_delta: round((fold - 1) * 0.12, 3),
      };
    });
    return [{ entity_id: id, name: e.name, trends: series }];
  });
  return { success: true, results: { trending: rows }, duration: 22 };
}

