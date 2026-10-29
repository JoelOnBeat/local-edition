import { canonicalId } from "../store/ids";
import { TavilyResponse } from "./schema";
import sampleWilliamsburg from "../../../fixtures/tavily/store_williamsburg.json";
import sampleParkSlope from "../../../fixtures/tavily/store_park-slope.json";
import sampleAstoria from "../../../fixtures/tavily/store_astoria.json";
import sampleHarlem from "../../../fixtures/tavily/store_harlem.json";
import sampleWestVillage from "../../../fixtures/tavily/store_west-village.json";
import sampleLowerEastSide from "../../../fixtures/tavily/store_lower-east-side.json";
import sampleUpperEastSide from "../../../fixtures/tavily/store_upper-east-side.json";
import sampleLongIslandCity from "../../../fixtures/tavily/store_long-island-city.json";

/**
 * Synthetic Tavily responses for the 8 sample stores (invented listings, week of Mon 2 Nov 2026,
 * example.com URLs). Imported as modules so they bundle for Workers; no runtime fs.
 * A store with no fixture (a store the visitor added) gets an empty result set: the edition then
 * has no tie-in and the event stands on block taste alone.
 */
const FIXTURES: Record<string, unknown> = {
  store_williamsburg: sampleWilliamsburg,
  "store_park-slope": sampleParkSlope,
  store_astoria: sampleAstoria,
  store_harlem: sampleHarlem,
  "store_west-village": sampleWestVillage,
  "store_lower-east-side": sampleLowerEastSide,
  "store_upper-east-side": sampleUpperEastSide,
  "store_long-island-city": sampleLongIslandCity,
};

export const TAVILY_FIXTURE_STORE_IDS = Object.keys(FIXTURES);

export function tavilyFixture(storeId: string, query: string): TavilyResponse {
  // Visitor-workspace stores carry `~<suffix>` ids; the fixtures are keyed by the canonical sample id.
  const raw = FIXTURES[canonicalId(storeId)];
  // Parsed on every use: a broken fixture fails loudly in tests, not silently in the UI.
  if (raw === undefined) return { query, results: [] };
  return { ...TavilyResponse.parse(raw), query };
}
