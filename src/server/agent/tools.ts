import { z } from "zod";
import type { ChatToolSpec } from "./ports";
import { menuMatch, partnersRank } from "./tools-match";
import { hostOf, round, type ToolDef } from "./tool-types";
import { TavilyBudgetError } from "../tavily/budget";
import { clip } from "./util";

export { storeBrief, type ToolCtx, type ToolDef, type ToolOutcome } from "./tool-types";

/** Tools the Nemotron agent can call. Each is a thin wrapper over a data port. */

const limitSchema = z.number().int().min(1).max(20).optional();
const emptyArgs = z.object({}).strict();
const noParams = { type: "object", properties: {}, additionalProperties: false };

const blockProfile: ToolDef<typeof emptyArgs> = {
  name: "block_profile",
  description: "Qloo taste profile of this store's block: the tags (cuisine, flavour, ambience, music) that over-index here versus the city.",
  parameters: noParams,
  schema: emptyArgs,
  async run({ sc, deps, mem }) {
    const { profile, evidence } = await deps.qloo.blockProfile(sc.store, sc.chain);
    mem.profile = profile;
    const ids = mem.addEvidence(evidence);
    return {
      summary: `${profile.tags.length} tags over-index on this block`,
      payload: { tags: profile.tags.map((t) => ({ tagId: t.tagId, name: t.name, kind: t.kind, lift: round(t.lift) })) },
      evidenceIds: ids,
    };
  },
};

/** A partner needs a few places to rank. */
const MIN_PLACES = 3;

const placesArgs = z.object({ tagIds: z.array(z.string().min(1)).max(5).optional(), limit: limitSchema });
const placesNear: ToolDef<typeof placesArgs> = {
  name: "places_near",
  description: "Local places near the store that match the chain's taste, as candidate partners. Optionally narrow by Qloo tag ids from block_profile.",
  parameters: {
    type: "object",
    properties: {
      tagIds: { type: "array", items: { type: "string" }, maxItems: 5, description: "Qloo tag ids to narrow by" },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    additionalProperties: false,
  },
  schema: placesArgs,
  async run({ sc, deps, mem }, args) {
    const found = await deps.qloo.placesNear(sc.store, sc.chain, args);
    let widened = false;
    if (args.tagIds?.length && found.items.length < MIN_PLACES) {
      // Qloo's tag filter is narrow (live answers often return none): top up from the unfiltered list, tag matches first. Real answers only.
      const rest = await deps.qloo.placesNear(sc.store, sc.chain, { limit: args.limit });
      const have = new Set(found.items.map((p) => p.entity.entityId));
      const extra = rest.items.filter((p) => !have.has(p.entity.entityId));
      widened = extra.length > 0;
      found.items = [...found.items, ...extra];
      found.evidence = [...found.evidence, ...rest.evidence];
    }
    const { items, evidence } = found;
    const ids = mem.addEvidence(evidence);
    const entries = mem.addPlaces(items);
    return {
      summary: `${entries.length} places within reach${widened ? " (too few matched those tags, so the tag filter was dropped)" : ""}`,
      payload: { places: entries.map((e) => ({ ref: e.ref, name: e.place.entity.name, distanceM: Math.round(e.place.distanceM), tags: e.place.tags.slice(0, 3), affinity: round(e.place.affinity) })) },
      evidenceIds: ids,
    };
  },
};

/** A plain genre word to Qloo's music genre tag urn; urns pass through untouched. */
export function genreTag(genre: string): string {
  const g = genre.trim();
  return g.startsWith("urn:") ? g : `urn:tag:genre:music:${g.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

/** A sound brief needs 8 artists (the contract's minimum). */
const MIN_ARTISTS = 8;

const artistsArgs = z.object({ genres: z.array(z.string().min(1)).max(5).optional(), limit: limitSchema });
const artistsLocal: ToolDef<typeof artistsArgs> = {
  name: "artists_local",
  description: "Artists that fit this block for the in-store playlist. Qloo returns artists, never tracks.",
  parameters: {
    type: "object",
    properties: { genres: { type: "array", items: { type: "string" }, maxItems: 5 }, limit: { type: "integer", minimum: 1, maximum: 20 } },
    additionalProperties: false,
  },
  schema: artistsArgs,
  async run({ sc, deps, mem }, args) {
    // The model names genres in plain words ("soul", "indie pop"); Qloo filters on tag urns.
    const genres = args.genres?.map(genreTag);
    const found = await deps.qloo.artistsLocal(sc.store, sc.chain, { ...args, genres });
    let widened = false;
    if (genres?.length && found.items.length < MIN_ARTISTS) {
      // A genre filter that leaves too few artists for a sound brief is topped up from the unfiltered list, genre matches first.
      const rest = await deps.qloo.artistsLocal(sc.store, sc.chain, { limit: args.limit });
      const have = new Set(found.items.map((a) => a.entity.entityId));
      const extra = rest.items.filter((a) => !have.has(a.entity.entityId));
      widened = extra.length > 0;
      found.items = [...found.items, ...extra];
      found.evidence = [...found.evidence, ...rest.evidence];
    }
    const ids = mem.addEvidence(found.evidence);
    const entries = mem.addArtists(found.items);
    return {
      summary: `${entries.length} artists for the room${widened ? " (too few matched those genres, so the genre filter was dropped)" : ""}`,
      payload: {
        artists: entries.map((e) => ({ ref: e.ref, name: e.artist.entity.name, genres: e.artist.genres?.slice(0, 2) })),
        ...(widened ? { note: "Too few artists matched the genres, so the list is topped up with unfiltered ones." } : {}),
      },
      evidenceIds: ids,
    };
  },
};

const brandsArgs = z.object({ limit: limitSchema });
const brandsLocal: ToolDef<typeof brandsArgs> = {
  name: "brands_local",
  description: "Brands that over-index around this block; ideas for what the store pairs well with.",
  parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
  schema: brandsArgs,
  async run({ sc, deps, mem }, args) {
    const { items, evidence } = await deps.qloo.brandsLocal(sc.store, sc.chain, args);
    const ids = mem.addEvidence(evidence);
    const entries = mem.addBrands(items);
    return { summary: `${entries.length} local brands`, payload: { brands: entries.map((e) => ({ ref: e.ref, name: e.brand.entity.name })) }, evidenceIds: ids };
  },
};

const risingArgs = z.object({ kind: z.enum(["place", "artist", "brand"]) });
const rising: ToolDef<typeof risingArgs> = {
  name: "rising",
  description: "What is rising in Qloo's population data for places, artists or brands near this store. Never say it is rising on this street.",
  parameters: { type: "object", properties: { kind: { type: "string", enum: ["place", "artist", "brand"] } }, required: ["kind"], additionalProperties: false },
  schema: risingArgs,
  async run({ sc, deps, mem }, args) {
    const { items, evidence } = await deps.qloo.rising(sc.store, sc.chain, args);
    const ids = mem.addEvidence(evidence);
    const entries = mem.addRising(items);
    return { summary: `${entries.length} rising ${args.kind}s`, payload: { rising: entries.map((e) => ({ ref: e.ref, name: e.item.entity.name, kind: e.item.kind, rankDelta: e.item.rankDelta })) }, evidenceIds: ids };
  },
};

const eventsThisWeek: ToolDef<typeof emptyArgs> = {
  name: "events_this_week",
  description: "Real events near the store this week (Tavily web search), usable as a tie-in for an event night.",
  parameters: noParams,
  schema: emptyArgs,
  async run({ sc, deps, mem }) {
    let found;
    try {
      found = await deps.tavily.eventsThisWeek(sc.store, sc.chain, sc.weekOf);
    } catch (e) {
      // No live search for this call (not the weekly sample build, or the credits are spent): say so, and carry on without an event tie-in.
      if (!(e instanceof TavilyBudgetError)) throw e;
      return {
        summary: "Using this week's saved events: live web search is not available for this store",
        payload: { events: [], note: e.message },
        evidenceIds: [],
      };
    }
    const { items, evidence } = found;
    const ids = mem.addEvidence(evidence);
    const entries = mem.addEvents(items);
    return {
      summary: `${entries.length} events this week`,
      payload: { events: entries.map((e) => ({ ref: e.ref, title: e.event.title, startsAt: e.event.startsAt, venue: e.event.venue ?? null, source: hostOf(e.event.url) })) },
      evidenceIds: ids,
    };
  },
};
export const TOOLS: ToolDef[] = [blockProfile, placesNear, artistsLocal, brandsLocal, rising, eventsThisWeek, menuMatch, partnersRank] as unknown as ToolDef[];
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolSpecs(): ChatToolSpec[] {
  return TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

/** Result text sent back to the model, capped so a long list cannot blow the context. */
export function renderPayload(payload: unknown): string {
  return clip(JSON.stringify(payload), 6000);
}
