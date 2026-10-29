import type { Evidence, QlooEntityRef } from "@/contract";

/** Shared builders for sample data. Everything under src/mocks is sample data, never real customers. */

export const MOCK_WEEK_OF = "2026-10-26"; // a Monday
export const MOCK_NOW = "2026-10-26T00:05:00.000Z"; // Monday 08:05 MYT
export const MOCK_ISSUE_NO = 43;
export const MOCK_WORKSPACE_ID = "ws_sample_demo";

export const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Deterministic 32-hex id that looks like a Qloo entity id (FNV-1a stretched). */
export function fakeEntityId(seed: string): string {
  let out = "";
  for (let round = 0; out.length < 32; round++) {
    let h = 0x811c9dc5 ^ (round * 0x9e3779b1);
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 32);
}

export const artist = (name: string): QlooEntityRef => ({
  entityId: fakeEntityId(`artist:${name}`),
  name,
  type: "urn:entity:artist",
});

export const artists = (names: string[]): QlooEntityRef[] => names.map(artist);

export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export const evidence = (e: Omit<Evidence, "fetchedAt" | "mode"> & Partial<Pick<Evidence, "fetchedAt" | "mode">>): Evidence => ({
  fetchedAt: MOCK_NOW,
  mode: "fixture",
  ...e,
});

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
