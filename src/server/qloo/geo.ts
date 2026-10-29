/** Geometry helpers. Qloo WKT is longitude first: POINT(lon lat). */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Coordinates at ~1 m precision; trims trailing zeros so URLs and recording keys stay stable. */
export function coord(n: number): string {
  return String(Number(n.toFixed(5)));
}

export function pointWkt(p: LatLon): string {
  return `POINT(${coord(p.lon)} ${coord(p.lat)})`;
}

/** Closed rectangular ring around a box, longitude first. */
export function polygonWkt(box: { minLat: number; maxLat: number; minLon: number; maxLon: number }): string {
  const { minLat, maxLat, minLon, maxLon } = box;
  const ring = [
    [minLon, minLat],
    [minLon, maxLat],
    [maxLon, maxLat],
    [maxLon, minLat],
    [minLon, minLat],
  ];
  return `POLYGON((${ring.map(([lo, la]) => `${coord(lo)} ${coord(la)}`).join(",")}))`;
}

export function boundsOf(points: LatLon[], padM: number) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLat = (padM / EARTH_RADIUS_M) * (180 / Math.PI);
  const padLon = padLat / Math.max(0.2, Math.cos(rad(midLat)));
  return {
    minLat: Math.min(...lats) - padLat,
    maxLat: Math.max(...lats) + padLat,
    minLon: Math.min(...lons) - padLon,
    maxLon: Math.max(...lons) + padLon,
  };
}

/** Move a point by metres north (dy) and east (dx). */
export function offsetPoint(p: LatLon, dxM: number, dyM: number): LatLon {
  const lat = p.lat + (dyM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lon = p.lon + (dxM / (EARTH_RADIUS_M * Math.cos(rad(p.lat)))) * (180 / Math.PI);
  return { lat, lon };
}

/** First coordinate pair of a WKT POINT/POLYGON (lon lat order), or undefined. */
export function parseWktPoint(wkt: string | undefined): LatLon | undefined {
  if (!wkt) return undefined;
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt);
  if (!m) return undefined;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
}

/** All coordinate pairs in a WKT string (lon lat order). */
export function parseWktCoords(wkt: string | undefined): LatLon[] {
  if (!wkt) return [];
  const out: LatLon[] = [];
  for (const m of wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ lat, lon });
  }
  return out;
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const round = (n: number, dp = 3) => Number(n.toFixed(dp));
