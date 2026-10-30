import { z } from "zod";
import { Connection, SyncEvent, Delivery } from "./connectors";
import type { RouteSpec } from "./route-spec";

/**
 * Square (system of record for the menu and the locations) and the calendar feed. Built on the shared Connection / SyncEvent /
 * Delivery shapes in connectors.ts. Owner: lane B2. Shapes of Square's own API live in src/server/connectors/square/schemas.ts.
 */

const id = z.string().min(1).max(64);
const iso = z.string().datetime({ offset: true });

/** How the chain connects: `sandbox` uses the server-held sandbox token (the sample chain); `oauth` sends the owner to Square. */
export const SquareConnectMethod = z.enum(["sandbox", "oauth"]);
export type SquareConnectMethod = z.infer<typeof SquareConnectMethod>;

/** One Square location and the Local Edition store it is tied to. `storeId` is null for a location with no store yet. */
export const SquareLocationLink = z.object({
  locationId: z.string().min(1).max(64),
  locationName: z.string().min(1).max(160),
  storeId: id.nullable(),
  storeName: z.string().nullable(),
});
export type SquareLocationLink = z.infer<typeof SquareLocationLink>;

/** What one import changed. Counts are item-level (a Square item with sizes counts once per size). */
export const SquareSyncResult = z.object({
  at: iso,
  menu: z.object({ added: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), changed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  stores: z.object({ linked: z.number().int().nonnegative(), created: z.number().int().nonnegative() }),
  /** Editions flagged "menu changed in Square at HH:MM" because they build on an item that changed or went away. */
  affectedEditionIds: z.array(id),
});
export type SquareSyncResult = z.infer<typeof SquareSyncResult>;

export const SquareStatus = z.object({
  connection: Connection,
  merchantId: z.string().nullable(),
  /** True when the server holds a sandbox token (the sample chain can connect in one click). */
  sandboxAvailable: z.boolean(),
  /** True when the OAuth application is configured (a real chain can connect its own Square account). */
  oauthAvailable: z.boolean(),
  locations: z.array(SquareLocationLink),
  menuItemCount: z.number().int().nonnegative(),
  lastWebhookAt: iso.nullable(),
  /** Square's own catalog `updated_at` from the last webhook: lets the UI say "menu changed in Square at 14:07". */
  lastCatalogChangeAt: iso.nullable(),
  /** The newest sync events (all providers' events are on /api/connections; these are Square's). */
  events: z.array(SyncEvent),
});
export type SquareStatus = z.infer<typeof SquareStatus>;

export const SquareConnectRequest = z.object({ method: SquareConnectMethod });
export const SquareConnectResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connected"), status: SquareStatus, result: SquareSyncResult }),
  /** OAuth: send the browser to `authorizeUrl`; Square returns to /api/connectors/square/callback, which redirects to /app/connections. */
  z.object({ kind: z.literal("redirect"), authorizeUrl: z.string().url() }),
]);
export type SquareConnectResponse = z.infer<typeof SquareConnectResponse>;

export const SquareSyncResponse = z.object({ status: SquareStatus, result: SquareSyncResult });
export type SquareSyncResponse = z.infer<typeof SquareSyncResponse>;

/** Square's reply to the webhook. 200 for every signed notification, handled or not, so Square never retries a no-op. */
export const SquareWebhookAck = z.object({ ok: z.literal(true), handled: z.boolean(), eventType: z.string() });
export type SquareWebhookAck = z.infer<typeof SquareWebhookAck>;

/** The query the callback receives from Square. `error` is set when the owner pressed Deny. */
export const SquareCallbackQuery = z.object({
  code: z.string().min(1).max(512).optional(),
  state: z.string().min(1).max(128).optional(),
  error: z.string().max(120).optional(),
  error_description: z.string().max(500).optional(),
  response_type: z.string().max(20).optional(),
});

/** Where the callback sends the browser: /app/connections?square=connected or ?square=error&reason=<code>. */
export const SQUARE_RETURN_PATH = "/app/connections";

export const DeliveriesResponse = z.object({ deliveries: z.array(Delivery) });
export type DeliveriesResponse = z.infer<typeof DeliveriesResponse>;

/** Stretch: units of an approved special sold since approval (Square Orders API). `sold` is null when it could not be read. */
export const SpecialSales = z.object({
  itemId: id,
  name: z.string(),
  sold: z.number().int().nonnegative().nullable(),
  since: iso,
  readAt: iso,
});
export type SpecialSales = z.infer<typeof SpecialSales>;
export const SalesResponse = z.object({ sales: z.array(SpecialSales) });
export type SalesResponse = z.infer<typeof SalesResponse>;

/**
 * One subscribable calendar feed of approved event nights. `url` is the https feed (`/api/calendar/<token>.ics`), `webcalUrl` the same
 * for "Open in Calendar", `googleUrl` / `outlookUrl` add it as a subscription. The token is the capability: treat the URL as private.
 */
export const CalendarFeed = z.object({
  scope: z.enum(["store", "chain"]),
  storeId: id.nullable(),
  label: z.string().min(1).max(160),
  url: z.string().url(),
  webcalUrl: z.string().min(1),
  googleUrl: z.string().url(),
  outlookUrl: z.string().url(),
  /** Approved event nights currently in the feed. */
  eventCount: z.number().int().nonnegative(),
});
export type CalendarFeed = z.infer<typeof CalendarFeed>;
export const CalendarFeedsResponse = z.object({ feeds: z.array(CalendarFeed) });
export type CalendarFeedsResponse = z.infer<typeof CalendarFeedsResponse>;

const tokenParams = z.object({ token: z.string().min(1).max(80) });
const none = { bodyKind: "none", sse: false } as const;
// Stream "E": every other src/app/api route. The handlers live in src/server/connectors/.
const base = { stream: "E" } as const;

/** Route table for the Square and calendar connectors. Merge into docs/CONTRACT.md and the api-client. */
export const squareRoutes = {
  getSquare: { ...base, ...none, method: "GET", path: "/api/connectors/square", request: z.object({}), response: SquareStatus },
  connectSquare: {
    ...base, method: "POST", path: "/api/connectors/square/connect", bodyKind: "json", sse: false,
    request: z.object({ body: SquareConnectRequest }), response: SquareConnectResponse,
  },
  /** Browser redirect target for Square's OAuth (response is a 302 to SQUARE_RETURN_PATH, not JSON). */
  squareCallback: {
    ...base, ...none, method: "GET", path: "/api/connectors/square/callback",
    request: z.object({ query: SquareCallbackQuery }), response: z.unknown(),
  },
  syncSquare: { ...base, ...none, method: "POST", path: "/api/connectors/square/sync", request: z.object({}), response: SquareSyncResponse },
  disconnectSquare: { ...base, ...none, method: "DELETE", path: "/api/connectors/square", request: z.object({}), response: z.object({ ok: z.literal(true) }) },
  /** Public, signed by Square (`x-square-hmacsha256-signature`); never called by the UI. */
  squareWebhook: {
    ...base, method: "POST", path: "/api/connectors/square/webhook", bodyKind: "json", sse: false,
    request: z.object({ headers: z.object({ "x-square-hmacsha256-signature": z.string().min(1).max(200) }), body: z.record(z.string(), z.unknown()) }),
    response: SquareWebhookAck,
  },
  /** Where an edition's approved items went (Square, Slack, mail): the edition page renders one chip per delivery. */
  listDeliveries: {
    ...base, ...none, method: "GET", path: "/api/connectors/deliveries",
    request: z.object({ query: z.object({ editionId: id }) }), response: DeliveriesResponse,
  },
  getSpecialSales: {
    ...base, ...none, method: "GET", path: "/api/connectors/square/sales",
    request: z.object({ query: z.object({ editionId: id }) }), response: SalesResponse,
  },
  getCalendarFeeds: { ...base, ...none, method: "GET", path: "/api/connectors/calendar", request: z.object({}), response: CalendarFeedsResponse },
  /** Public, the token is the capability. `:token` ends in `.ics`. Responds `text/calendar`. */
  getCalendarIcs: {
    ...base, ...none, method: "GET", path: "/api/calendar/:token",
    request: z.object({ params: tokenParams }), response: z.string(),
  },
} satisfies Record<string, RouteSpec>;
