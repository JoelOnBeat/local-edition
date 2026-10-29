import type { AgentEvent, ItemAction, RouteId, RouteInput, RouteOutput } from "@/contract";

export class ApiClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
  }
}

export type Out<K extends RouteId> = Promise<RouteOutput<K>>;
export type Body<K extends RouteId> = RouteInput<K> extends { body: infer B } ? B : never;
export type AgentEventStream = AsyncIterable<AgentEvent>;

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
  patchItem(editionId: string, itemId: string, action: ItemAction): Out<"patchItem">;
  approveAll(editionId: string): Out<"approveAll">;
  getCard(editionId: string): Out<"getCard">;
  getPublicCard(token: string): Out<"getPublicCard">;
  /** Normally called by cron with an HMAC; exposed for tests and the manual-run button's server proxy. */
  runMondayJob(signature: string, body?: Body<"runMondayJob">): Out<"runMondayJob">;
  getLatestJob(): Out<"getLatestJob">;
  getStatus(): Out<"getStatus">;
}

export interface ApiClientOptions {
  mode?: "mock" | "app";
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Mock mode only: pause per call (ms) and per streamed event. */
  mockDelayMs?: number;
  mockEventDelayMs?: number;
}

