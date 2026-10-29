import { z } from "zod";
import {
  BlockProfile,
  Chain,
  CompareResult,
  Edition,
  EditionItem,
  Evidence,
  JobRun,
  MenuItem,
  ProviderStatus,
  QlooEntityRef,
  StaffCard,
  Store,
  Weekday,
  Workspace,
  isoDate,
} from "./domain";
import { AgentEvent } from "./events";

/** API route table. Source of truth: docs/CONTRACT.md. Request/response are zod schemas. */

export const MENU_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MENU_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type StreamOwner = "A" | "B" | "C" | "E";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type BodyKind = "none" | "json" | "csv" | "multipart";

export interface RouteSpec {
  method: HttpMethod;
  /** Next.js style with `:param` segments. */
  path: string;
  /** Owning backend stream (docs/BUILD.md ownership table). */
  stream: StreamOwner;
  bodyKind: BodyKind;
  /** Shape of the input: any of { params, query, headers, body }. */
  request: z.ZodObject;
  /** JSON response schema, or the single event schema when `sse` is true. */
  response: z.ZodType;
  /** True when the response is a text/event-stream of `response` events. */
  sse: boolean;
}

const idParams = z.object({ id: z.string().min(1) });
const itemParams = z.object({ id: z.string().min(1), itemId: z.string().min(1) });

export const ChainUpdate = Chain.pick({ name: true, brandVoice: true, anchors: true });
export type ChainUpdate = z.infer<typeof ChainUpdate>;

export const StoreInput = Store.pick({ name: true, addressLabel: true, lat: true, lon: true });
export type StoreInput = z.infer<typeof StoreInput>;

export const WorkspaceBundle = z.object({
  workspace: Workspace,
  chain: Chain,
  stores: z.array(Store),
  menu: z.array(MenuItem),
  latestEditions: z.array(Edition),
});
export type WorkspaceBundle = z.infer<typeof WorkspaceBundle>;

export const ProfileResponse = z.object({ profile: BlockProfile, evidence: z.array(Evidence) });
export type ProfileResponse = z.infer<typeof ProfileResponse>;
export const CompareResponse = z.object({ result: CompareResult, evidence: z.array(Evidence) });
export type CompareResponse = z.infer<typeof CompareResponse>;

/** Public staff card page: the card plus its store and chain name. */
export const PublicStaffCard = z.object({ card: StaffCard, store: Store, chainName: z.string() });
export type PublicStaffCard = z.infer<typeof PublicStaffCard>;

/** Editable copy fields of an item; `edit` re-runs guardrails server-side. */
export const ItemPatch = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    staffLine: z.string().min(1),
    flavourTags: z.array(z.string()),
    brief: z.string().min(1),
    mood: z.string().min(1),
    reason: z.string().min(1),
    offerIdea: z.string().min(1),
    title: z.string().min(1),
    day: Weekday,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .partial();
export type ItemPatch = z.infer<typeof ItemPatch>;

export const ItemAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({
    action: z.literal("edit"),
    patch: ItemPatch.refine((p) => Object.keys(p).length > 0, "patch must change at least one field"),
  }),
]);
export type ItemAction = z.infer<typeof ItemAction>;

export const MenuImage = z
  .instanceof(File)
  .refine((f) => f.size <= MENU_IMAGE_MAX_BYTES, "image must be 5 MB or smaller")
  .refine((f) => (MENU_IMAGE_TYPES as readonly string[]).includes(f.type), "image must be jpg, png or webp");

export const routes = {
  getWorkspace: {
    method: "GET", path: "/api/workspace", stream: "E", bodyKind: "none", sse: false,
    request: z.object({}), response: WorkspaceBundle,
  },
  putChain: {
    method: "PUT", path: "/api/chain", stream: "E", bodyKind: "json", sse: false,
    request: z.object({ body: ChainUpdate }), response: Chain,
  },
  importStores: {
    method: "POST", path: "/api/stores/import", stream: "E", bodyKind: "csv", sse: false,
    request: z.object({ body: z.string().min(1) }), // text/csv: name,address,lat,lon
    response: z.array(Store),
  },
  createStore: {
    method: "POST", path: "/api/stores", stream: "E", bodyKind: "json", sse: false,
    request: z.object({ body: StoreInput }), response: Store,
  },
  deleteStore: {
    method: "DELETE", path: "/api/stores/:id", stream: "E", bodyKind: "none", sse: false,
    request: z.object({ params: idParams }), response: z.object({ ok: z.literal(true) }),
  },
  readMenu: {
    method: "POST", path: "/api/menu/read", stream: "A", bodyKind: "multipart", sse: false,
    request: z.object({ body: z.object({ image: MenuImage }) }), response: z.array(MenuItem),
  },
  putMenu: {
    method: "PUT", path: "/api/menu", stream: "E", bodyKind: "json", sse: false,
    request: z.object({ body: z.array(MenuItem) }), response: z.array(MenuItem),
  },
  searchAnchors: {
    method: "GET", path: "/api/anchors/search", stream: "B", bodyKind: "none", sse: false,
    request: z.object({ query: z.object({ q: z.string().trim().min(1).max(80) }) }),
    response: z.array(QlooEntityRef),
  },
  getStoreProfile: {
    method: "GET", path: "/api/stores/:id/profile", stream: "B", bodyKind: "none", sse: false,
    request: z.object({ params: idParams }), response: ProfileResponse,
  },
  compareStores: {
    method: "GET", path: "/api/compare", stream: "B", bodyKind: "none", sse: false,
    request: z.object({ query: z.object({ a: z.string().min(1), b: z.string().min(1) }) }),
    response: CompareResponse,
  },
  buildEditions: {
    method: "POST", path: "/api/editions/build", stream: "C", bodyKind: "json", sse: true,
    request: z.object({ body: z.object({ storeIds: z.array(z.string().min(1)).optional() }) }),
    response: AgentEvent,
  },
  regenerateItem: {
    method: "POST", path: "/api/editions/:id/items/:itemId/regenerate", stream: "C", bodyKind: "json", sse: true,
    request: z.object({ params: itemParams, body: z.object({ hint: z.string().max(280).optional() }) }),
    response: AgentEvent,
  },
  listEditions: {
    method: "GET", path: "/api/editions", stream: "E", bodyKind: "none", sse: false,
    request: z.object({ query: z.object({ weekOf: isoDate.optional() }) }), response: z.array(Edition),
  },
  getEdition: {
    method: "GET", path: "/api/editions/:id", stream: "E", bodyKind: "none", sse: false,
    request: z.object({ params: idParams }), response: Edition,
  },
  patchItem: {
    method: "PATCH", path: "/api/editions/:id/items/:itemId", stream: "E", bodyKind: "json", sse: false,
    request: z.object({ params: itemParams, body: ItemAction }), response: EditionItem,
  },
  approveAll: {
    method: "POST", path: "/api/editions/:id/approve-all", stream: "E", bodyKind: "none", sse: false,
    request: z.object({ params: idParams }), response: Edition,
  },
  getCard: {
    method: "GET", path: "/api/editions/:id/card", stream: "C", bodyKind: "none", sse: false,
    request: z.object({ params: idParams }), response: StaffCard,
  },
  getPublicCard: {
    method: "GET", path: "/api/card/:token", stream: "E", bodyKind: "none", sse: false,
    request: z.object({ params: z.object({ token: z.string().min(1) }) }), response: PublicStaffCard,
  },
  runMondayJob: {
    method: "POST", path: "/api/jobs/monday", stream: "E", bodyKind: "json", sse: false,
    request: z.object({
      // HMAC-SHA256 (hex) of the raw request body, keyed by LE_JOB_SECRET.
      headers: z.object({ "x-le-signature": z.string().min(1) }),
      body: z.object({ storeIds: z.array(z.string().min(1)).optional() }),
    }),
    response: JobRun,
  },
  getLatestJob: {
    method: "GET", path: "/api/jobs/latest", stream: "E", bodyKind: "none", sse: false,
    request: z.object({}), response: JobRun.nullable(),
  },
  getStatus: {
    method: "GET", path: "/api/status", stream: "E", bodyKind: "none", sse: false,
    request: z.object({}), response: ProviderStatus,
  },
} as const satisfies Record<string, RouteSpec>;

export type Routes = typeof routes;
export type RouteId = keyof Routes;
export type RouteInput<K extends RouteId> = z.input<Routes[K]["request"]>;
export type RouteOutput<K extends RouteId> = z.output<Routes[K]["response"]>;
export type SseRouteId = { [K in RouteId]: Routes[K]["sse"] extends true ? K : never }[RouteId];

export const routeTable: ReadonlyArray<{ id: RouteId } & RouteSpec> = (Object.keys(routes) as RouteId[]).map(
  (id) => ({ id, ...routes[id] }),
);

export const ApiError = z.object({ error: z.string(), code: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;
