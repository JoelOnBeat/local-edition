import type {
  AgentEvent, CommsState, ConnectionsResponse, Delivery, ItemAction, RegenerateSuggestion, RouteId, RouteInput, RouteOutput,
} from "@/contract";
import type { SeqEvent } from "./sse-client";

export class ApiClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
  }
}

export type Out<K extends RouteId> = Promise<RouteOutput<K>>;
export type Body<K extends RouteId> = RouteInput<K> extends { body: infer B } ? B : never;
export type AgentEventStream = AsyncIterable<AgentEvent>;

export type { SeqEvent } from "./sse-client";

export interface StreamOptions {
  signal?: AbortSignal;
}

export interface ApiClient {
  getWorkspace(): Out<"getWorkspace">;
  putChain(body: Body<"putChain">): Out<"putChain">;
  importStores(csv: string): Out<"importStores">;
  createStore(body: Body<"createStore">): Out<"createStore">;
  deleteStore(id: string): Out<"deleteStore">;
  readMenu(image: File): Out<"readMenu">;
  putMenu(items: Body<"putMenu">): Out<"putMenu">;
  searchAnchors(q: string): Out<"searchAnchors">;
  getStoreProfile(storeId: string): Out<"getStoreProfile">;
  compareStores(a: string, b: string): Out<"compareStores">;
  buildEditions(body: Body<"buildEditions">, opts?: StreamOptions): AgentEventStream;
  regenerateItem(editionId: string, itemId: string, body?: Body<"regenerateItem">, opts?: StreamOptions): AgentEventStream;
  listEditions(weekOf?: string): Out<"listEditions">;
  getEdition(id: string): Out<"getEdition">;
  /** `version` is the item's current `version`, sent as `If-Match`; a stale one fails with 409 `version_conflict`. */
  patchItem(editionId: string, itemId: string, action: ItemAction, version: number): Out<"patchItem">;
  approveAll(editionId: string): Out<"approveAll">;
  getCard(editionId: string): Out<"getCard">;
  getPublicCard(token: string): Out<"getPublicCard">;
  /** Normally called by cron with an HMAC; exposed for tests and the manual-run button's server proxy. */
  runMondayJob(signature: string, body?: Body<"runMondayJob">): Out<"runMondayJob">;
  getLatestJob(): Out<"getLatestJob">;
  getStatus(): Out<"getStatus">;
  // Upgrade routes.
  getProof(): Out<"getProof">;
  getLimits(): Out<"getLimits">;
  /** Ultra review pass over the workspace's editions (SSE). */
  reviewEditions(body?: Body<"reviewEditions">, opts?: StreamOptions): AgentEventStream;
  /** One Tavily crawl of the chain's pages, then Lightning writes brand-voice lines. Spends Tavily credits. */
  generateBrandVoice(): Out<"generateBrandVoice">;
  // Connector routes (src/contract/routes-connectors.ts, connectors-comms.ts).
  /** Where an edition's approved items went (Square, Slack, mail), newest first. */
  listDeliveries(editionId: string): Promise<Delivery[]>;
  /** Square, Slack, Gmail, Outlook and the derived calendar row, plus every sync event newest first. */
  getConnections(): Promise<ConnectionsResponse>;
  /** Store replies ("From the store" notes), open regenerate suggestions, targets and deliveries. */
  getComms(): Promise<CommsState>;
  /** Accept (`applied`, after the regenerate ran) or dismiss a suggestion. */
  patchSuggestion(id: string, status: "applied" | "dismissed"): Promise<RegenerateSuggestion>;
  /** Checks the connected mailbox for store replies now. */
  pollMail(): Promise<{ checked: number; newReplies: number }>;
  /**
   * Re-attaches to the workspace's latest build run and replays it after `afterSeq` (Last-Event-ID). Each event carries its `id:`
   * so the caller can resume from the last one it saw. Mock mode has no stored run and yields nothing.
   */
  resumeBuild(afterSeq: number, opts?: StreamOptions): AsyncIterable<SeqEvent>;
  /** Job-only routes, signed with an HMAC. Exposed for tests; the browser never holds the secret. */
  getPendingJobs(signature: string): Out<"getPendingJobs">;
  postJobResults(signature: string, body: Body<"postJobResults">): Out<"postJobResults">;
  postJobEval(signature: string, body: Body<"postJobEval">): Out<"postJobEval">;
}

export interface ApiClientOptions {
  mode?: "mock" | "app";
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Mock mode only: pause per call (ms) and per streamed event. */
  mockDelayMs?: number;
  mockEventDelayMs?: number;
}

