import { STORE_FIXTURES, TAG_TYPES, fakeUuid } from "../../../../fixtures/qloo";
import { clamp, haversineM, parseWktCoords, parseWktPoint, round, type LatLon } from "../geo";
import { entityIndex, artistsFor, brandsFor, list, noise, num, nearestFixture, placesFor, refOf, type Json, type Named } from "./context";

/** `/v2/insights` fixtures for urn:tag, places, artists, brands and heatmaps. */

/** How strongly the chain's taste shows up around each sample store (synthetic; UES and LIC run cold). */
const HEAT_AMP: Record<string, number> = {
  williamsburg: 0.7, "park-slope": 0.55, astoria: 0.18, harlem: 0.6, "west-village": 0.75,
  "lower-east-side": 0.28, "upper-east-side": -0.14, "long-island-city": 0.06,
};

const envelope = (results: Json): Json => ({ success: true, results, duration: 14 });
const BIAS: Record<string, number> = { off: 0, very_low: 0.02, low: 0.05, mid: 0.15, medium: 0.15, high: 1.2, very_high: 1.6 };
const takeOf = (p: Record<string, string>, dflt = 20) => Math.round(clamp(num(p.take) ?? dflt, 1, 50));
const biasOf = (p: Record<string, string>) => BIAS[p["bias.trends"] ?? "medium"] ?? 0.15;

const matchesTag = (tagIds: string[], wanted: string[]) =>
  !wanted.length || wanted.some((w) => tagIds.some((t) => t === w || t.startsWith(`${w}:`)));

function explain(entity: Json, anchors: string[]): Json {
  if (!anchors.length) return entity;
  const index = entityIndex();
  const weights = anchors.map((id) => ({ entity_id: id, name: index.get(id)?.name, w: 0.2 + 0.8 * Math.abs(noise(String(entity.entity_id), id)) }));
  const sum = weights.reduce((a, b) => a + b.w, 0);
  const query = { ...(entity.query as Json), explainability: { entities: weights.map((x) => ({ entity_id: x.entity_id, name: x.name, impact: round(x.w / sum) })) } };
  return { ...entity, query };
}

function tags(p: Record<string, string>): Json {
  const point = parseWktPoint(p["signal.location"]);
  const type = p["filter.tag.types"];
  const defs = TAG_TYPES.filter((t) => !type || t.type === type);
  const fx = point ? nearestFixture(point) : undefined;
  const seed = point ? `${point.lat.toFixed(3)},${point.lon.toFixed(3)}` : "city";
  const out = defs.flatMap((def) =>
    def.tags.map(([slug, name, base]) => {
      const boost = fx?.boosts[`${def.key}:${slug}`];
      const affinity = boost ?? clamp(base + (fx ? noise(seed, `${def.key}:${slug}`) * 0.04 : 0), 0.02, 0.99);
      return { tag_id: `${def.type}:${slug}`, name, types: [def.type], subtype: def.type, query: { affinity: round(affinity) } };
    }),
  );
  out.sort((a, b) => b.query.affinity - a.query.affinity || a.tag_id.localeCompare(b.tag_id));
  return envelope({ tags: out.slice(0, takeOf(p)) });
}

function places(p: Record<string, string>): Json {
  const point = parseWktPoint(p["filter.location"]);
  const radius = num(p["filter.location.radius"]);
  const pool = point
    ? placesFor(nearestFixture(point), point).filter((x) => !radius || haversineM(point, x) <= radius)
    : STORE_FIXTURES.flatMap((fx) => placesFor(fx, refOf(fx)));
  const wanted = list(p["filter.tags"]);
  const unwanted = list(p["filter.exclude.tags"]);
  const excluded = new Set(list(p["filter.exclude.entities"]));
  const minRating = num(p["filter.properties.business_rating.min"]);
  const bias = biasOf(p);
  const anchors = p["feature.explainability"] === "true" ? list(p["signal.interests.entities"]) : [];
  const rows = pool
    .filter((x) => matchesTag(x.tagIds, wanted) && !(unwanted.length && matchesTag(x.tagIds, unwanted)) && !excluded.has(x.id))
    .filter((x) => minRating === undefined || ((x.entity.properties as Json).business_rating as number) >= minRating)
    .sort((a, b) => b.affinity + bias * b.trend - (a.affinity + bias * a.trend) || a.name.localeCompare(b.name));
  return envelope({ entities: rows.slice(0, takeOf(p)).map((x) => explain(x.entity, anchors)) });
}

function ranked(pool: Named[], p: Record<string, string>, anchors: string[]): Json {
  const min = num(p["filter.popularity.min"]) ?? 0;
  const max = num(p["filter.popularity.max"]) ?? 1;
  const wanted = list(p["filter.tags"]);
  const unwanted = list(p["filter.exclude.tags"]);
  const excluded = new Set(list(p["filter.exclude.entities"]));
  const bias = biasOf(p);
  const rows = pool
    .filter((x) => x.popularity >= min && x.popularity <= max && matchesTag(x.tagIds, wanted) && !excluded.has(x.id))
    .filter((x) => !(unwanted.length && matchesTag(x.tagIds, unwanted)))
    .sort((a, b) => b.affinity + bias * b.trend - (a.affinity + bias * a.trend) || a.name.localeCompare(b.name));
  return envelope({ entities: rows.slice(0, takeOf(p)).map((x) => explain(x.entity, anchors)) });
}

const mergeCity = (pick: (fx: (typeof STORE_FIXTURES)[number]) => Named[]): Named[] => {
  const byId = new Map<string, Named[]>();
  for (const fx of STORE_FIXTURES) for (const n of pick(fx)) byId.set(n.id, [...(byId.get(n.id) ?? []), n]);
  return [...byId.values()].map((rows) => ({ ...rows[0], affinity: rows.reduce((a, r) => a + r.affinity, 0) / rows.length * 0.8 }));
};

function artists(p: Record<string, string>): Json {
  const point = parseWktPoint(p["signal.location"]);
  const pool = point ? artistsFor(nearestFixture(point)) : mergeCity(artistsFor);
  return ranked(pool, p, p["feature.explainability"] === "true" ? list(p["signal.interests.entities"]) : []);
}

function brands(p: Record<string, string>): Json {
  const point = parseWktPoint(p["signal.location"]);
  return ranked(point ? brandsFor(nearestFixture(point)) : mergeCity(brandsFor), p, []);
}

function heatmap(p: Record<string, string>): Json {
  const ring = parseWktCoords(p["filter.location"]);
  if (!ring.length) return envelope({ heatmap: [] });
  const lats = ring.map((c) => c.lat);
  const lons = ring.map((c) => c.lon);
  const n = Math.max(2, Math.floor(Math.sqrt(takeOf(p, 49))));
  const stores = STORE_FIXTURES.map((fx) => ({ at: refOf(fx), amp: HEAT_AMP[fx.slug] ?? 0.3 }));
  const cells: { location: Json; at: LatLon; affinity: number; popularity: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lat = Math.min(...lats) + ((Math.max(...lats) - Math.min(...lats)) * (i + 0.5)) / n;
      const lon = Math.min(...lons) + ((Math.max(...lons) - Math.min(...lons)) * (j + 0.5)) / n;
      let bump = 0;
      for (const s of stores) bump += s.amp * Math.exp(-((haversineM({ lat, lon }, s.at) / 1100) ** 2));
      const affinity = clamp(0.36 + bump + noise("heat", `${i},${j}`) * 0.05, 0.02, 0.99);
      cells.push({ location: { latitude: round(lat, 6), longitude: round(lon, 6), geohash: fakeUuid(`${i},${j}`).slice(0, 7).replace(/-/g, "") }, at: { lat, lon }, affinity, popularity: clamp(0.2 + bump * 0.7, 0.05, 0.99) });
    }
  }
  const order = [...cells].sort((a, b) => a.affinity - b.affinity);
  return envelope({
    heatmap: cells.map((c) => ({
      location: c.location,
      query: { affinity: round(c.affinity), affinity_rank: round(order.indexOf(c) / Math.max(1, cells.length - 1)), popularity: round(c.popularity) },
    })),
  });
}

export function insights(p: Record<string, string>): Json {
  switch (p["filter.type"]) {
    case "urn:tag": return tags(p);
    case "urn:entity:place": return places(p);
    case "urn:entity:artist": return artists(p);
    case "urn:entity:brand": return brands(p);
    case "urn:heatmap": return heatmap(p);
    default: return envelope({ entities: [] });
  }
}
