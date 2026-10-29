import Papa from "papaparse";
import type { Edition, EditionItem, ItemAction, MenuItem, QlooEntityRef, Store } from "@/contract";
import {
  buildMockCard, editionStatusOf, getMockProfile, mockBuildEvents, mockCompare, mockJobRun,
  mockPublicCard, mockRegenerateEvents, mockStatus, mockWorkspaceBundle, profileEvidence,
} from "@/mocks";
import { newId } from "./ids";
import { ApiClientError, type ApiClient, type ApiClientOptions } from "./api-types";

/** In-memory stand-in for the whole backend, used when NEXT_PUBLIC_DATA_MODE=mock. Resets on reload. */

const BRANDS = [
  "Blue Bottle Coffee", "Aesop", "Muji", "Stumptown Coffee Roasters", "La Colombe", "Le Labo", "Everlane",
  "Sweetgreen", "Rapha", "Ace Hotel", "Kinfolk", "Patagonia", "Glossier", "Warby Parker", "Equinox",
];
const brandRef = (name: string): QlooEntityRef => ({
  entityId: `sample-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name,
  type: "urn:entity:brand",
});

/** Stand-in for the guardrail pass: strips exclamation marks and flags health claims. */
const HEALTH_CLAIM = /\b(healthy|healthier|detox|cures?|boosts?|antioxidants?|immune|immunity|weight loss|energy|vegan-safe|allergen-free)\b/i;

function applyGuardrail(item: EditionItem): EditionItem {
  const text = JSON.stringify(item);
  if (HEALTH_CLAIM.test(text)) {
    return { ...item, status: "flagged", guardrail: { status: "blocked", rail: "no-health-claims", reasons: ["Health, diet or nutrition claims are not allowed."] } };
  }
  if (text.includes("!")) {
    const cleaned = JSON.parse(text.replace(/!/g, ".")) as EditionItem;
    return { ...cleaned, guardrail: { status: "rewritten", rail: "brand-voice", reasons: ["Removed exclamation marks."], original: text.slice(0, 160) } };
  }
  return { ...item, guardrail: { status: "passed", reasons: [] } };
}

export function createMockApi(opts: Pick<ApiClientOptions, "mockDelayMs" | "mockEventDelayMs"> = {}): ApiClient {
  const delayMs = opts.mockDelayMs ?? 150;
  const eventDelayMs = opts.mockEventDelayMs ?? 350;
  const wait = () => (delayMs > 0 ? new Promise<void>((r) => setTimeout(r, delayMs)) : Promise.resolve());
  const db = mockWorkspaceBundle();
  const editionOrThrow = (id: string): Edition => {
    const e = db.latestEditions.find((x) => x.id === id);
    if (!e) throw new ApiClientError(404, "not_found", "That edition does not exist.");
    return e;
  };
  const withStatus = (e: Edition): Edition => ({ ...e, status: editionStatusOf(e.items) });
  const replaceEdition = (e: Edition): Edition => {
    const next = withStatus(e);
    db.latestEditions = db.latestEditions.map((x) => (x.id === next.id ? next : x));
    return structuredClone(next);
  };
  const nextColor = () => ((db.stores.length % 8) + 1);

  const run = async <T>(fn: () => T): Promise<T> => {
    await wait();
    return structuredClone(fn());
  };

  return {
    getWorkspace: () => run(() => ({ ...db, latestEditions: db.latestEditions })),
    putChain: (body) => run(() => { db.chain = { ...db.chain, ...body }; return db.chain; }),
    importStores: (csv) => run(() => {
      const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
      const added: Store[] = [];
      for (const row of parsed.data) {
        const lat = Number(row.lat);
        const lon = Number(row.lon);
        if (!row.name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const store: Store = { id: newId("store"), chainId: db.chain.id, name: row.name.trim(), addressLabel: (row.address ?? row.name).trim(), lat, lon, colorIndex: nextColor() };
        db.stores.push(store);
        added.push(store);
      }
      if (added.length === 0) throw new ApiClientError(400, "invalid_input", "No valid rows. Expected columns: name,address,lat,lon.");
      return added;
    }),
    createStore: (body) => run(() => {
      const store: Store = { id: newId("store"), chainId: db.chain.id, ...body, colorIndex: nextColor() };
      db.stores.push(store);
      return store;
    }),
    deleteStore: (id) => run(() => {
      db.stores = db.stores.filter((s) => s.id !== id);
      db.latestEditions = db.latestEditions.filter((e) => e.storeId !== id);
      return { ok: true as const };
    }),
    readMenu: async (image) => {
      await wait();
      if (image.size > 5 * 1024 * 1024) throw new ApiClientError(413, "image_too_large", "Menu photos must be 5 MB or smaller.");
      return structuredClone(db.menu.map((m): MenuItem => ({ ...m, source: "vl" })));
    },
    putMenu: (items) => run(() => { db.menu = items; return db.menu; }),
    searchAnchors: (q) => run(() => BRANDS.filter((b) => b.toLowerCase().includes(q.toLowerCase())).slice(0, 8).map(brandRef)),
    getStoreProfile: (id) => run(() => {
      const profile = getMockProfile(id);
      if (!profile) throw new ApiClientError(404, "not_found", "No profile for that store yet.");
      return { profile, evidence: [profileEvidence(id)] };
    }),
    compareStores: (a, b) => run(() => {
      const r = mockCompare(a, b);
      if (!r) throw new ApiClientError(404, "not_found", "Both stores need a profile to compare.");
      return r;
    }),
    buildEditions: (body, o) => mockBuildEvents(body.storeIds, { delayMs: eventDelayMs, signal: o?.signal }),
    regenerateItem: (id, itemId, body, o) => mockRegenerateEvents(editionOrThrow(id), itemId, body?.hint, { delayMs: eventDelayMs, signal: o?.signal }),
    listEditions: (weekOf) => run(() => db.latestEditions.filter((e) => !weekOf || e.weekOf === weekOf)),
    getEdition: (id) => run(() => editionOrThrow(id)),
    patchItem: (id, itemId, action: ItemAction) => run(() => {
      const edition = editionOrThrow(id);
      const current = edition.items.find((i) => i.id === itemId);
      if (!current) throw new ApiClientError(404, "not_found", "That item does not exist.");
      if (action.action === "approve" && current.guardrail.status === "blocked") {
        throw new ApiClientError(409, "guardrail_blocked", "Blocked items must be edited or regenerated before approval.");
      }
      if (action.action === "approve" && current.guardrail.status === "unchecked") {
        throw new ApiClientError(409, "guardrail_unchecked", "This item has not passed guardrails yet, so it cannot be approved.");
      }
      let next: EditionItem = { ...current, version: current.version + 1 };
      if (action.action === "approve") next.status = "approved";
      else if (action.action === "reject") next.status = "rejected";
      else next = applyGuardrail({ ...next, ...action.patch, status: "edited" } as EditionItem);
      const items = edition.items.map((i) => (i.id === itemId ? next : i));
      replaceEdition({ ...edition, items });
      return next;
    }),
    approveAll: (id) => run(() => {
      const edition = editionOrThrow(id);
      const items = edition.items.map((i): EditionItem =>
        i.status === "rejected" || i.status === "flagged" || i.guardrail.status === "unchecked" || i.guardrail.status === "blocked"
          ? i
          : { ...i, status: "approved", version: i.status === "approved" ? i.version : i.version + 1 });
      return replaceEdition({ ...edition, items });
    }),
    getCard: (id) => run(() => buildMockCard(editionOrThrow(id))),
    getPublicCard: (token) => run(() => {
      const card = mockPublicCard(token);
      if (!card) throw new ApiClientError(404, "not_found", "This card link is not active.");
      return card;
    }),
    runMondayJob: (signature) => run(() => {
      if (!signature) throw new ApiClientError(401, "bad_signature", "Missing signature.");
      return { ...mockJobRun, trigger: "manual" as const };
    }),
    getLatestJob: () => run(() => mockJobRun),
    getStatus: () => run(() => mockStatus),
  };
}
