import Papa from "papaparse";
import type { AgentEvent, Edition, EditionItem, EvalResult, ItemAction, MenuItem, Store } from "@/contract";
import {
  buildMockCard, editionStatusOf, getMockProfile, mockBrandVoice, mockBuildEvents, mockCompare, mockEval, mockJobRun,
  mockLimits, mockProof, mockPublicCard, mockRegenerateEvents, mockReviewEvents, mockStatus, mockWorkspaceBundle,
  profileEvidence,
} from "@/mocks";
import { reviewsOf, seenModels } from "@/server/handlers/proof-steps";
import { SUGGESTED_ANCHORS } from "./anchor-suggestions";
import { mockAfterBuild, mockComms, mockDeliveriesFor, mockMergedConnections, mockOnApproval, mockPatchSuggestion, resetMockConnectors } from "./mock-connectors";
import { createMockAuth } from "./mock-auth";
import { newId } from "./ids";
import { ApiClientError, type ApiClient, type ApiClientOptions } from "./api-types";

/** In-memory stand-in for the whole backend, used when NEXT_PUBLIC_DATA_MODE=mock. Resets on reload. */

/** Stand-in for the guardrail pass: strips exclamation marks and flags health claims. */
const HEALTH_CLAIM = /\b(healthy|healthier|detox|cures?|boosts?|antioxidants?|immune|immunity|weight loss|energy|vegan-safe|allergen-free)\b/i;

function applyGuardrail(item: EditionItem): EditionItem {
  const text = JSON.stringify(item);
  if (HEALTH_CLAIM.test(text)) {
    return { ...item, status: "flagged", guardrail: { status: "blocked", rail: "no-health-claims", reasons: ["Health, diet or nutrition claims are not allowed."], checkedBy: "live" } };
  }
  if (text.includes("!")) {
    const cleaned = JSON.parse(text.replace(/!/g, ".")) as EditionItem;
    return { ...cleaned, guardrail: { status: "rewritten", rail: "brand-voice", reasons: ["Removed exclamation marks."], original: text.slice(0, 160), checkedBy: "live" } };
  }
  return { ...item, guardrail: { status: "passed", reasons: [], checkedBy: "live" } };
}

/** The copy a certify job reads for an item: every free-text field, joined. */
function itemText(item: EditionItem): string {
  switch (item.kind) {
    case "special": return `${item.name}. ${item.description} ${item.staffLine}`;
    case "sound": return `${item.brief} ${item.mood}`;
    case "partner": return `${item.reason} ${item.offerIdea}`;
    case "event": return `${item.title}. ${item.description}`;
  }
}

export function createMockApi(opts: Pick<ApiClientOptions, "mockDelayMs" | "mockEventDelayMs"> = {}): ApiClient {
  const delayMs = opts.mockDelayMs ?? 150;
  const eventDelayMs = opts.mockEventDelayMs ?? 350;
  const wait = () => (delayMs > 0 ? new Promise<void>((r) => setTimeout(r, delayMs)) : Promise.resolve());
  const db = mockWorkspaceBundle();
  resetMockConnectors();
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
  let evalResult: EvalResult | null = mockEval;
  const approvedStores = () =>
    new Set(db.latestEditions.filter((e) => e.items.some((i) => i.status === "approved" || i.status === "edited")).map((e) => e.storeId));
  const nextColor = () => ((db.stores.length % 8) + 1);

  const requireSignature = (signature: string) => {
    if (!signature) throw new ApiClientError(401, "bad_signature", "Missing signature.");
  };
  async function* reviewStream(weekOf: string | undefined, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const editions = db.latestEditions.filter((e) => !weekOf || e.weekOf === weekOf);
    for await (const event of mockReviewEvents(editions, { delayMs: eventDelayMs, signal })) {
      if (event.type === "review") {
        const target = db.latestEditions.find((e) => e.storeId === event.storeId);
        const { verdict, reason, clashWith, hint, reviewedBy } = event;
        if (target) replaceEdition({ ...target, review: { verdict, reason, clashWith, hint, reviewedBy, at: new Date().toISOString() } });
      }
      yield event;
    }
  }

  /** The head-office digest goes to Slack once a build reports `run_done`, as the server does. */
  async function* afterBuild(events: AsyncIterable<AgentEvent>): AsyncGenerator<AgentEvent> {
    for await (const event of events) {
      if (event.type === "run_done") mockAfterBuild(event.editionIds.length);
      yield event;
    }
  }

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
    searchAnchors: (q) => run(() => SUGGESTED_ANCHORS.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)),
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
    buildEditions: (body, o) => afterBuild(mockBuildEvents(body.storeIds, { delayMs: eventDelayMs, signal: o?.signal, force: body.force, approvedStoreIds: approvedStores() })),
    regenerateItem: (id, itemId, body, o) => mockRegenerateEvents(editionOrThrow(id), itemId, body?.hint, { delayMs: eventDelayMs, signal: o?.signal }),
    listEditions: (weekOf) => run(() => db.latestEditions.filter((e) => !weekOf || e.weekOf === weekOf)),
    getEdition: (id) => run(() => editionOrThrow(id)),
    patchItem: (id, itemId, action: ItemAction, version) => run(() => {
      const edition = editionOrThrow(id);
      const current = edition.items.find((i) => i.id === itemId);
      if (!current) throw new ApiClientError(404, "not_found", "That item does not exist.");
      if (typeof version !== "number") throw new ApiClientError(428, "version_required", "Send the item's version in an If-Match header.");
      if (version !== current.version) throw new ApiClientError(409, "version_conflict", "Someone changed this item. Reload to see the latest copy.");
      if (action.action === "approve" && (current.guardrail.status === "blocked" || current.status === "flagged")) {
        throw new ApiClientError(409, "guardrail_blocked", "Blocked items must be edited or regenerated before approval.");
      }
      if (action.action === "approve" && current.guardrail.status === "unchecked" && action.override !== true) {
        throw new ApiClientError(409, "guardrail_unchecked", "This item has not passed guardrails yet. Approve it only if you have read it yourself.");
      }
      let next: EditionItem = { ...current, version: current.version + 1 };
      if (action.action === "approve") next.status = "approved";
      else if (action.action === "reject") next.status = "rejected";
      else next = applyGuardrail({ ...next, ...action.patch, status: "edited" } as EditionItem);
      const items = edition.items.map((i) => (i.id === itemId ? next : i));
      mockOnApproval(edition, replaceEdition({ ...edition, items }));
      return next;
    }),
    approveAll: (id) => run(() => {
      const edition = editionOrThrow(id);
      const items = edition.items.map((i): EditionItem =>
        i.status === "rejected" || i.status === "flagged" || i.guardrail.status === "unchecked" || i.guardrail.status === "blocked"
          ? i
          : { ...i, status: "approved", version: i.status === "approved" ? i.version : i.version + 1 });
      const after = replaceEdition({ ...edition, items });
      mockOnApproval(edition, after);
      return after;
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
    getProof: () => run(() => ({
      ...mockProof, eval: evalResult,
      seenModels: seenModels(db.latestEditions), editionCount: db.latestEditions.length, reviews: reviewsOf(db.latestEditions, db.stores),
    })),
    getLimits: () => run(() => mockLimits),
    reviewEditions: (body, o) => reviewStream(body?.weekOf, o?.signal),
    generateBrandVoice: () => run(() => mockBrandVoice),
    listDeliveries: (editionId) => run(() => mockDeliveriesFor(editionId)),
    getConnections: () => run(() => mockMergedConnections()),
    getComms: () => run(() => mockComms()),
    patchSuggestion: (id, status) => run(() => {
      const next = mockPatchSuggestion(id, status);
      if (!next) throw new ApiClientError(404, "not_found", "That suggestion does not exist.");
      return next;
    }),
    pollMail: () => run(() => ({ checked: mockComms().connections.filter((c) => c.status === "connected" && c.provider !== "slack").length, newReplies: 0 })),
    // The mock backend keeps no run log: nothing to replay.
    resumeBuild: () => (async function* () { /* no stored run */ })(),
    listRuns: () => run(() => ({ runs: [] })),
    ...createMockAuth(db, run),
    getPendingJobs: (signature) => run(() => {
      requireSignature(signature);
      const items = db.latestEditions.flatMap((e) =>
        e.items
          .filter((i) => i.guardrail.checkedBy !== "nemo-guardrails@nebius-job" && i.status !== "rejected")
          .map((i) => ({ editionId: e.id, itemId: i.id, kind: i.kind, text: itemText(i), brandVoice: db.chain.brandVoice })));
      return { items };
    }),
    postJobResults: (signature, body) => run(() => {
      requireSignature(signature);
      let updated = 0;
      for (const r of body.results) {
        const edition = db.latestEditions.find((e) => e.id === r.editionId);
        const item = edition?.items.find((i) => i.id === r.itemId);
        if (!edition || !item) continue;
        // A blocked verdict on approved copy flips it back to flagged so head office sees why.
        const status = r.guardrail.status === "blocked" && item.status === "approved" ? "flagged" : item.status;
        replaceEdition({ ...edition, items: edition.items.map((i): EditionItem => (i.id === item.id ? { ...i, status, guardrail: r.guardrail } : i)) });
        updated++;
      }
      return { updated };
    }),
    postJobEval: (signature, body) => run(() => {
      requireSignature(signature);
      evalResult = body;
      return { ok: true as const };
    }),
  };
}
