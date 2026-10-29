/** Compact fixture rows. Expanded into documented Qloo envelopes by src/server/qloo/fixtures/. */

/** [name, address, tags, dxM east, dyM north, affinity, popularity, rating 0-5, trend 0-1] */
export type PlaceRow = [string, string, string, number, number, number, number, number, number];
/** [artist slug, affinity, trend 0-1] */
export type ArtistRow = [string, number, number];
/** [brand slug, affinity] */
export type BrandRow = [string, number];

export interface StoreFixture {
  /** Sample store id is `store_<slug>`. */
  slug: string;
  /** `typeKey:tagSlug` -> affinity at this block (everything else sits at the city baseline). */
  boosts: Record<string, number>;
  places: PlaceRow[];
  artists: ArtistRow[];
  brands: BrandRow[];
}
