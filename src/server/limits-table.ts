import type { RateLimitRow } from "@/contract";

/**
 * The request allowances that guard the routes spending model or search credits, defined once: the routes read them to enforce, and
 * GET /api/limits reads them to display. A bucket is a burst (`capacity`) that refills `refillPerMinute` tokens a minute.
 */

export interface Bucket {
  capacity: number;
  refillPerMinute: number;
}
export interface RouteLimits {
  workspace: Bucket;
  ip: Bucket;
}

export const SPEND_LIMITS = {
  build: { workspace: { capacity: 4, refillPerMinute: 1 }, ip: { capacity: 12, refillPerMinute: 3 } },
  regenerate: { workspace: { capacity: 10, refillPerMinute: 4 }, ip: { capacity: 30, refillPerMinute: 10 } },
  card: { workspace: { capacity: 10, refillPerMinute: 5 }, ip: { capacity: 30, refillPerMinute: 10 } },
  edit: { workspace: { capacity: 30, refillPerMinute: 20 }, ip: { capacity: 90, refillPerMinute: 40 } },
} as const satisfies Record<string, RouteLimits>;

export const MENU_READ_LIMITS: RouteLimits = { workspace: { capacity: 6, refillPerMinute: 3 }, ip: { capacity: 12, refillPerMinute: 6 } };
export const ANCHOR_SEARCH_LIMITS: RouteLimits = { workspace: { capacity: 30, refillPerMinute: 30 }, ip: { capacity: 60, refillPerMinute: 60 } };
export const BRAND_VOICE_LIMITS: RouteLimits = { workspace: { capacity: 3, refillPerMinute: 1 }, ip: { capacity: 6, refillPerMinute: 3 } };

const say = (b: Bucket): string => `${b.capacity}, then ${b.refillPerMinute} a minute`;

/** The rows /limits shows. */
export function rateLimitRows(): RateLimitRow[] {
  const row = (action: string, l: RouteLimits): RateLimitRow => ({ action, workspace: say(l.workspace), ip: say(l.ip) });
  return [
    row("Build editions", SPEND_LIMITS.build),
    row("Regenerate an item", SPEND_LIMITS.regenerate),
    row("Staff card", SPEND_LIMITS.card),
    row("Edit an item", SPEND_LIMITS.edit),
    row("Read a menu photo", MENU_READ_LIMITS),
    row("Search Qloo brands", ANCHOR_SEARCH_LIMITS),
    row("Draft brand voice", BRAND_VOICE_LIMITS),
  ];
}
