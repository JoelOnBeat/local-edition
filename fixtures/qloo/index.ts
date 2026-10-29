import { ARTISTS } from "./artists";
import { BRANDS } from "./brands";
import { ASTORIA, HARLEM, PARK_SLOPE, WILLIAMSBURG } from "./stores-a";
import { LONG_ISLAND_CITY, LOWER_EAST_SIDE, UPPER_EAST_SIDE, WEST_VILLAGE } from "./stores-b";
import type { StoreFixture } from "./types";

export { ARTISTS, BRANDS };
export { TAG_TYPES, PLACE_GENRES, PLACE_GENRE_PREFIX, resolveRowTag } from "./tags";
export { fakeUuid } from "./ids";
export type { StoreFixture, PlaceRow } from "./types";

/** The eight sample stores, in sample-chain order. */
export const STORE_FIXTURES: StoreFixture[] = [
  WILLIAMSBURG, PARK_SLOPE, ASTORIA, HARLEM, WEST_VILLAGE, LOWER_EAST_SIDE, UPPER_EAST_SIDE, LONG_ISLAND_CITY,
];
