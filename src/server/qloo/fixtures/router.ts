import { audiences, compare, entities, search, tagSearch, trending } from "./misc";
import { insights } from "./insights";

/**
 * Synthetic stand-in for the Qloo API: same paths, same parameters, documented envelope shapes.
 * Used for QLOO_MODE=fixture and as the replay-miss fallback. Deterministic for equal inputs.
 */
export function respond(path: string, params: Record<string, string>): unknown {
  switch (path) {
    case "/search": return search(params);
    case "/entities": return entities(params);
    case "/v2/insights": return insights(params);
    case "/v2/tags": return tagSearch(params);
    case "/v2/audiences": return audiences(params);
    case "/v2/analysis/compare": return compare(params);
    case "/v2/trending": return trending(params);
    default: return { success: true, results: {}, duration: 1 };
  }
}
