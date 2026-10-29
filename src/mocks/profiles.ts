import type { BlockProfile, BlockTag, Evidence, TagKind } from "@/contract";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { MOCK_NOW, evidence, slugify } from "./helpers";

/** [name, kind, affinity, lift]. Lift is store affinity minus the New York baseline. */
type TagRow = [string, TagKind, number, number];

const rows: Record<string, TagRow[]> = {
  williamsburg: [
    ["Indie Rock", "music", 0.91, 0.34], ["Vintage Shopping", "activity", 0.88, 0.31],
    ["Record Stores", "activity", 0.86, 0.29], ["Natural Wine", "flavour", 0.82, 0.27],
    ["Vegan Bakery", "cuisine", 0.79, 0.24], ["Rooftop Bars", "ambience", 0.77, 0.21],
    ["Street Art", "activity", 0.74, 0.18], ["Specialty Coffee", "flavour", 0.93, 0.12],
  ],
  "park-slope": [
    ["Farmers Markets", "activity", 0.9, 0.33], ["Independent Bookstores", "activity", 0.87, 0.3],
    ["Family Brunch", "cuisine", 0.84, 0.27], ["Folk and Singer-Songwriter", "music", 0.8, 0.22],
    ["Pastry Counters", "cuisine", 0.78, 0.2], ["Community Gardens", "activity", 0.73, 0.17],
    ["Quiet Cafes", "ambience", 0.76, 0.15], ["Specialty Coffee", "flavour", 0.9, 0.09],
  ],
  astoria: [
    ["Greek Pastries", "cuisine", 0.92, 0.38], ["Frappe and Iced Coffee", "flavour", 0.85, 0.3],
    ["Beer Gardens", "ambience", 0.83, 0.28], ["Mediterranean Music", "music", 0.78, 0.23],
    ["Street Soccer", "activity", 0.75, 0.2], ["Honey and Sesame", "flavour", 0.73, 0.18],
    ["Outdoor Seating", "ambience", 0.77, 0.14], ["Specialty Coffee", "flavour", 0.84, 0.03],
  ],
  harlem: [
    ["Jazz and Soul", "music", 0.93, 0.4], ["Southern Baking", "cuisine", 0.88, 0.32],
    ["Live Music Nights", "activity", 0.86, 0.29], ["Spiced Tea", "flavour", 0.8, 0.24],
    ["Gospel Brunch", "cuisine", 0.79, 0.21], ["Community Murals", "activity", 0.74, 0.17],
    ["Record Stores", "activity", 0.72, 0.15], ["Specialty Coffee", "flavour", 0.86, 0.05],
  ],
  "west-village": [
    ["Jazz Clubs", "music", 0.9, 0.35], ["Independent Bookstores", "activity", 0.88, 0.31],
    ["Cozy Wine Bars", "ambience", 0.85, 0.27], ["French Pastry", "cuisine", 0.83, 0.25],
    ["Poetry Readings", "activity", 0.76, 0.2], ["Cobblestone Strolls", "activity", 0.74, 0.16],
    ["Candlelit Cafes", "ambience", 0.77, 0.13], ["Specialty Coffee", "flavour", 0.91, 0.1],
  ],
  "lower-east-side": [
    ["Punk and Post-Punk", "music", 0.92, 0.37], ["Late-Night Dining", "activity", 0.89, 0.33],
    ["Dive Bars", "ambience", 0.84, 0.26], ["Vintage Vinyl", "activity", 0.82, 0.24],
    ["Natural Wine", "flavour", 0.8, 0.25], ["Zine Shops", "activity", 0.75, 0.19],
    ["Dumplings", "cuisine", 0.78, 0.16], ["Specialty Coffee", "flavour", 0.89, 0.08],
  ],
  "upper-east-side": [
    ["Classical Music", "music", 0.89, 0.32], ["Museum Visits", "activity", 0.88, 0.3],
    ["Afternoon Tea", "flavour", 0.84, 0.26], ["Fine Pastry", "cuisine", 0.82, 0.22],
    ["Quiet Reading Rooms", "ambience", 0.78, 0.2], ["Art Galleries", "activity", 0.77, 0.18],
    ["Neighbourhood Bakeries", "cuisine", 0.75, 0.14], ["Specialty Coffee", "flavour", 0.85, 0.04],
  ],
  "long-island-city": [
    ["Waterfront Walks", "activity", 0.9, 0.34], ["Electronic and House", "music", 0.87, 0.31],
    ["Contemporary Art Spaces", "activity", 0.85, 0.28], ["Craft Beer", "flavour", 0.81, 0.24],
    ["Standing Desks and Co-working", "ambience", 0.79, 0.21], ["Food Halls", "cuisine", 0.77, 0.18],
    ["Skyline Views", "ambience", 0.74, 0.15], ["Specialty Coffee", "flavour", 0.92, 0.11],
  ],
};

const slugOf = (storeId: string) => storeId.replace(/^store_/, "");

export function tagsFor(storeId: string): BlockTag[] {
  return (rows[slugOf(storeId)] ?? [])
    .map(([name, kind, affinity, lift]) => ({ tagId: `urn:tag:${kind}:place:${slugify(name)}`, name, kind, affinity, lift }))
    .sort((a, b) => b.lift - a.lift);
}

export function profileEvidenceId(storeId: string): string {
  return `ev_${slugOf(storeId)}_profile`;
}

export function profileEvidence(storeId: string): Evidence {
  const store = SAMPLE_STORES.find((s) => s.id === storeId)!;
  const top = tagsFor(storeId)[0];
  return evidence({
    id: profileEvidenceId(storeId),
    source: "qloo",
    endpoint: "/v2/insights",
    params: {
      "filter.type": "urn:tag",
      "signal.location.query": `POINT(${store.lon} ${store.lat})`,
      "signal.location.radius": "800",
    },
    summary: `Sample data. Tags that over-index within 800 m of ${store.addressLabel}; strongest is ${top.name}.`,
    metrics: { affinity: top.affinity, lift: top.lift },
    entityIds: [],
  });
}

export const mockProfiles: BlockProfile[] = SAMPLE_STORES.map((s) => ({
  storeId: s.id,
  tags: tagsFor(s.id),
  evidenceIds: [profileEvidenceId(s.id)],
  computedAt: MOCK_NOW,
}));

export const getMockProfile = (storeId: string): BlockProfile | undefined =>
  mockProfiles.find((p) => p.storeId === storeId);
