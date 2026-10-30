import type { CalendarFeed, Delivery, SalesResponse, SquareConnectResponse, SquareStatus, SquareSyncResult, SyncEvent } from "@/contract";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { MOCK_NOW } from "./helpers";
import { mockEditionId } from "./editions";

/** Sample data for the Square and calendar UI. Everything here is the labelled sample chain's sandbox, never a real seller. */

const MERCHANT_ID = "MLSAMPLE0KETTLE";
const at = (minutesAgo: number) => new Date(Date.parse(MOCK_NOW) - minutesAgo * 60_000).toISOString();

export const mockSquareLocations: SquareStatus["locations"] = SAMPLE_STORES.map((s, i) => ({
  locationId: `L${String(i + 1).padStart(3, "0")}KK${s.id.slice(6, 10).toUpperCase()}`,
  locationName: `Kettle & Kiln ${s.name}`,
  storeId: s.id,
  storeName: s.name,
}));

export const mockSquareEvents: SyncEvent[] = [
  { id: "sync_sq_05", provider: "square", at: at(3), direction: "in", kind: "menu.changed", summary: "Menu changed in Square: Cortado is now $5.00 (was $4.75).", storeId: null, editionId: null, ok: true },
  { id: "sync_sq_04", provider: "square", at: at(3), direction: "in", kind: "webhook.received", summary: "Square sent catalog.version.updated; signature verified.", storeId: null, editionId: null, ok: true },
  { id: "sync_sq_03", provider: "square", at: at(130), direction: "out", kind: "special.published", summary: "Published \"Cardamom Morning Bun with orange zest\" to Square at Williamsburg.", storeId: "store_williamsburg", editionId: mockEditionId("store_williamsburg"), ok: true },
  { id: "sync_sq_02", provider: "square", at: at(1500), direction: "in", kind: "menu.imported", summary: "Imported 20 menu items and 8 locations from Square.", storeId: null, editionId: null, ok: true },
  { id: "sync_sq_01", provider: "square", at: at(1501), direction: "in", kind: "connection.created", summary: "Connected Kettle & Kiln (sample chain) to Square sandbox.", storeId: null, editionId: null, ok: true },
];

export const mockSquareStatus: SquareStatus = {
  connection: {
    provider: "square", status: "connected", mode: "sandbox", accountLabel: "Kettle & Kiln (sample chain) · Square sandbox",
    connectedAt: at(1501), lastSyncAt: at(3), error: null,
    capabilities: ["Reads the menu and locations", "Updates within seconds of a change in Square", "Publishes approved specials to the store's location"],
  },
  merchantId: MERCHANT_ID,
  sandboxAvailable: true,
  oauthAvailable: true,
  locations: mockSquareLocations,
  menuItemCount: 20,
  lastWebhookAt: at(3),
  lastCatalogChangeAt: at(3),
  events: mockSquareEvents,
};

export const mockSquareDisconnected: SquareStatus = {
  ...mockSquareStatus,
  connection: { ...mockSquareStatus.connection, status: "not_connected", mode: null, accountLabel: null, connectedAt: null, lastSyncAt: null },
  merchantId: null, locations: [], menuItemCount: 0, lastWebhookAt: null, lastCatalogChangeAt: null, events: [],
};

export const mockSquareSync: SquareSyncResult = {
  at: at(3),
  menu: { added: 0, removed: 0, changed: 1, total: 20 },
  stores: { linked: 8, created: 0 },
  affectedEditionIds: [mockEditionId("store_williamsburg")],
};

export const mockSquareConnect: SquareConnectResponse = { kind: "connected", status: mockSquareStatus, result: mockSquareSync };

export const mockDeliveries = (editionId: string): Delivery[] => {
  const store = SAMPLE_STORES.find((s) => mockEditionId(s.id) === editionId);
  if (!store) return [];
  return [
    {
      provider: "square", editionId, itemId: null, status: "sent", externalId: "KKMORNINGBUN7Q2XA",
      url: "https://squareupsandbox.com/dashboard/items/library/KKMORNINGBUN7Q2XA", at: at(130),
      note: `Limited item at ${store.name}, $5.00. Idempotency key kept, so re-approving updates it.`,
    },
  ];
};

export const mockSales: SalesResponse = {
  sales: [{ itemId: "item_special_williamsburg", name: "Cardamom Morning Bun with orange zest", sold: 37, since: at(130), readAt: MOCK_NOW }],
};

const feedUrl = (token: string) => `https://localedition.pages.dev/api/calendar/${token}.ics`;
const feed = (scope: CalendarFeed["scope"], storeId: string | null, label: string, token: string, eventCount: number): CalendarFeed => {
  const url = feedUrl(token);
  return {
    scope, storeId, label, url, eventCount,
    webcalUrl: url.replace(/^https:/, "webcal:"),
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https:/, "webcal:"))}`,
    outlookUrl: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(label)}`,
  };
};

export const mockCalendarFeeds: CalendarFeed[] = [
  feed("chain", null, "Kettle & Kiln (sample chain): all event nights", "kkchain7h2m9xq4v8a1c6dzw", 8),
  ...SAMPLE_STORES.map((s, i) => feed("store", s.id, `Kettle & Kiln ${s.name}: event nights`, `kk${s.id.slice(6, 10)}${String(i).padStart(2, "0")}x7k2p9m4qv`, 1)),
];

export const mockCalendarIcs = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Local Edition//Event nights//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:Kettle & Kiln event nights`,
  "BEGIN:VEVENT", `UID:${mockEditionId("store_williamsburg")}-event@localedition.pages.dev`, `DTSTAMP:20261026T000500Z`,
  `DTSTART;TZID=America/New_York:20261029T190000`, `SUMMARY:Vinyl and a pour-over`, `LOCATION:Bedford Ave & N 7th St\\, Williamsburg`, "END:VEVENT", "END:VCALENDAR",
].join("\r\n");

