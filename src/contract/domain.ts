import { z } from "zod";
import { EditionReview, GuardrailChecker, ItemVerification, JobMode, TieInTriage } from "./upgrade";

/** Domain types for Local Edition. Source of truth: docs/CONTRACT.md. */

export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();
/** Every id is at most 64 characters (KV keys are limited and ids reach Qloo params). */
const id = z.string().min(1).max(64);

export const DataMode = z.enum(["live", "replay", "fixture", "cache"]);
export type DataMode = z.infer<typeof DataMode>;
export const ProviderMode = z.enum(["live", "replay", "fixture", "cache", "missing-key"]);
export type ProviderMode = z.infer<typeof ProviderMode>;

export const QlooEntityRef = z.object({
  entityId: id,
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(80), // urn:entity:...
});
export type QlooEntityRef = z.infer<typeof QlooEntityRef>;

export const ChainCategory = z.enum(["coffee", "restaurant", "gym", "hotel"]);
export type ChainCategory = z.infer<typeof ChainCategory>;

export const Chain = z.object({
  id,
  name: z.string().min(1).max(80),
  category: ChainCategory,
  brandVoice: z.array(z.string().min(1).max(140)).min(1).max(3),
  anchors: z.array(QlooEntityRef).min(1).max(3),
  city: z.object({ name: z.string().min(1).max(80), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  isSample: z.boolean(),
});
export type Chain = z.infer<typeof Chain>;

export const Store = z.object({
  id,
  chainId: id,
  name: z.string().min(1).max(80), // neighbourhood
  addressLabel: z.string().min(1).max(160), // "Bedford Ave & N 7th St"
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  colorIndex: z.number().int().min(1).max(8),
});
export type Store = z.infer<typeof Store>;

export const MenuCategory = z.enum(["coffee", "tea", "bakery", "food", "cold", "other"]);
export type MenuCategory = z.infer<typeof MenuCategory>;

export const MenuItem = z.object({
  id,
  name: z.string().min(1).max(80),
  category: MenuCategory,
  price: z.number().nonnegative().nullable(),
  currency: z.literal("USD"),
  description: z.string().max(240).nullable(),
  source: z.enum(["vl", "manual"]),
  /** From the VL verify pass: the item was found on the photo. Absent means true. */
  seen: z.boolean().optional(),
  /** From the VL verify pass: the price could be read. Absent means true; false shows amber. */
  priceLegible: z.boolean().optional(),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const EvidenceSource = z.enum(["qloo", "tavily", "tokenfactory"]);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

export const EvidenceMetrics = z.object({
  affinity: z.number().optional(),
  popularity: z.number().optional(),
  lift: z.number().optional(),
  distanceM: z.number().optional(),
  relevance: z.number().optional(),
});
export type EvidenceMetrics = z.infer<typeof EvidenceMetrics>;

export const Evidence = z.object({
  id,
  source: EvidenceSource,
  endpoint: z.string().min(1), // path only, never a key
  params: z.record(z.string(), z.string()), // never a key
  summary: z.string().min(1),
  metrics: EvidenceMetrics,
  entityIds: z.array(z.string()),
  url: z.string().optional(),
  fetchedAt: isoDateTime,
  mode: DataMode,
});
export type Evidence = z.infer<typeof Evidence>;

export const TagKind = z.enum(["cuisine", "flavour", "ambience", "music", "activity", "other"]);
export type TagKind = z.infer<typeof TagKind>;

export const BlockTag = z.object({
  tagId: z.string().min(1).max(200), // a tag urn, longer than an id
  name: z.string().min(1),
  kind: TagKind,
  affinity: z.number(),
  lift: z.number(), // store affinity minus city baseline
});
export type BlockTag = z.infer<typeof BlockTag>;

export const BlockProfile = z.object({
  storeId: id,
  tags: z.array(BlockTag).max(12),
  evidenceIds: z.array(z.string()),
  computedAt: isoDateTime,
});
export type BlockProfile = z.infer<typeof BlockProfile>;

export const GuardrailStatus = z.enum(["passed", "rewritten", "blocked", "unchecked"]);
export type GuardrailStatus = z.infer<typeof GuardrailStatus>;

export const GuardrailResult = z.object({
  status: GuardrailStatus,
  rail: z.string().optional(),
  reasons: z.array(z.string()),
  original: z.string().optional(),
  /** Who produced the verdict: the Worker's live check, or the NeMo Guardrails library in a Nebius job started on demand from the CLI. Absent means `live`. */
  checkedBy: GuardrailChecker.optional(),
  /** When the Nebius job certified it. Only set with `checkedBy: "nemo-guardrails@nebius-job"`. */
  certifiedAt: isoDateTime.optional(),
  /** The Nebius job that certified it. */
  jobId: z.string().min(1).max(120).optional(),
});
export type GuardrailResult = z.infer<typeof GuardrailResult>;

export const ItemStatus = z.enum(["draft", "flagged", "approved", "edited", "rejected"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const Weekday = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
export type Weekday = z.infer<typeof Weekday>;

const itemCommon = {
  id,
  status: ItemStatus,
  evidenceIds: z.array(z.string().min(1)).min(1), // >= 1, else the item is dropped
  guardrail: GuardrailResult,
  version: z.number().int().nonnegative(),
  /** Evidence re-check (lift recomputed, entities looked up). Null or absent when nothing was verified. */
  verification: ItemVerification.nullable().optional(),
};

export const SpecialItem = z.object({
  ...itemCommon,
  kind: z.literal("special"),
  baseMenuItemId: id,
  name: z.string().min(1),
  description: z.string().min(1),
  flavourTags: z.array(z.string()),
  staffLine: z.string().min(1),
});
export const SoundItem = z.object({
  ...itemCommon,
  kind: z.literal("sound"),
  brief: z.string().min(1), // 1-2 sentences
  mood: z.string().min(1),
  artists: z.array(QlooEntityRef).min(8).max(15),
});
export const PartnerItem = z.object({
  ...itemCommon,
  kind: z.literal("partner"),
  place: QlooEntityRef.extend({
    address: z.string().nullable(),
    lat: z.number(),
    lon: z.number(),
    distanceM: z.number().nonnegative(),
  }),
  reason: z.string().min(1),
  offerIdea: z.string().min(1),
});
export const EventItem = z.object({
  ...itemCommon,
  kind: z.literal("event"),
  title: z.string().min(1),
  day: Weekday,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), // "19:00"
  description: z.string().min(1),
  tieIn: z
    .object({
      title: z.string(),
      url: z.string(),
      source: z.literal("tavily"),
      venue: z.string().max(160).nullable().optional(),
      /** ISO date when the listing gives one. */
      date: z.string().max(40).nullable().optional(),
      triage: TieInTriage.optional(),
    })
    .nullable(),
});

export const EditionItem = z.discriminatedUnion("kind", [SpecialItem, SoundItem, PartnerItem, EventItem]);
export type EditionItem = z.infer<typeof EditionItem>;
export type SpecialItem = z.infer<typeof SpecialItem>;
export type SoundItem = z.infer<typeof SoundItem>;
export type PartnerItem = z.infer<typeof PartnerItem>;
export type EventItem = z.infer<typeof EventItem>;
export type EditionItemKind = EditionItem["kind"];

export const EditionStatus = z.enum(["drafting", "draft", "flagged", "approved"]);
export type EditionStatus = z.infer<typeof EditionStatus>;

export const Edition = z.object({
  id,
  storeId: id,
  weekOf: isoDate, // a Monday
  issueNo: z.number().int().positive(),
  items: z.array(EditionItem),
  evidence: z.array(Evidence),
  status: EditionStatus,
  generatedBy: z.object({ agentModel: z.string(), copyModel: z.string(), runId: z.string() }),
  createdAt: isoDateTime,
  /** The Ultra reviewer's verdict on this edition. Null or absent before a review has run. */
  review: EditionReview.nullable().optional(),
});
export type Edition = z.infer<typeof Edition>;

export const StaffCard = z.object({
  editionId: id,
  storeId: id,
  token: z.string().min(1), // share link id
  lines: z.array(z.object({ heading: z.string().min(1), body: z.string().min(1) })),
  guardrail: GuardrailResult,
});
export type StaffCard = z.infer<typeof StaffCard>;

export const CompareResult = z.object({
  a: id,
  b: id,
  shared: z.array(BlockTag),
  onlyA: z.array(BlockTag),
  onlyB: z.array(BlockTag),
  evidenceIds: z.array(z.string()),
});
export type CompareResult = z.infer<typeof CompareResult>;

export const JobRun = z.object({
  id,
  /** `cron`: the Worker's weekly rebuild. `manual`: a Nebius job (certify, eval, import) started on demand from the CLI; it never runs on a schedule. */
  trigger: z.enum(["cron", "manual"]),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  storeIds: z.array(z.string()),
  status: z.enum(["running", "done", "failed"]),
  /** The Nebius job's name (`local-edition-<modes>-<yyyymmddhhmm>`) for certify, eval and import runs; null for the rebuild, which never calls Nebius. */
  nebiusJobId: z.string().nullable(),
  note: z.string(),
  /** Which job this was. Absent on rows written before the upgrade. */
  mode: JobMode.optional(),
  /** sha256 of the job script that ran, so the proof page can show what executed. */
  scriptSha: z.string().min(7).max(64).nullable().optional(),
});
export type JobRun = z.infer<typeof JobRun>;

export const ProviderStatus = z.object({
  qloo: ProviderMode,
  tokenfactory: ProviderMode,
  tavily: ProviderMode,
  guardrails: z.enum(["up", "down", "local"]),
  spend: z.object({ usd: z.number().nonnegative(), capUsd: z.number().nonnegative() }),
});
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const Workspace = z.object({ id, chainId: id, createdAt: isoDateTime });
export type Workspace = z.infer<typeof Workspace>;
