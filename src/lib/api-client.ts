import type { z } from "zod";
import { formatIfMatch, routes, type AgentEvent, type RouteId, type RouteOutput } from "@/contract";
import { clientDataMode } from "./env";
import { createMockApi } from "./mock-api";
import { ApiClientError, type AgentEventStream, type ApiClient, type ApiClientOptions, type Out } from "./api-types";
import { parseSseStream } from "./sse-client";

export { ApiClientError } from "./api-types";
export type { AgentEventStream, ApiClient, ApiClientOptions, StreamOptions } from "./api-types";

/** Typed client for every route in `routes`. NEXT_PUBLIC_DATA_MODE=mock returns src/mocks data. */

interface CallInput {
  params?: Record<string, string>;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
}

function buildUrl(base: string, path: string, input: CallInput): string {
  const filled = path.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(input.params?.[k] ?? ""));
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(input.query ?? {})) if (v !== undefined && v !== "") qs.set(k, v);
  const s = qs.toString();
  return `${base}${filled}${s ? `?${s}` : ""}`;
}

async function toError(res: Response): Promise<ApiClientError> {
  try {
    const j = (await res.json()) as { error?: string; code?: string };
    return new ApiClientError(res.status, j.code ?? "http_error", j.error ?? `Request failed (${res.status}).`);
  } catch {
    return new ApiClientError(res.status, "http_error", `Request failed (${res.status}).`);
  }
}

function createHttpApi(baseUrl = "", fetchImpl: typeof fetch = (...a) => fetch(...a)): ApiClient {
  const send = async (id: RouteId, input: CallInput, signal?: AbortSignal): Promise<Response> => {
    const spec = routes[id];
    const headers: Record<string, string> = { ...input.headers };
    let body: BodyInit | undefined;
    if (spec.bodyKind === "json") {
      headers["content-type"] = "application/json";
      body = JSON.stringify(input.body ?? {});
    } else if (spec.bodyKind === "csv") {
      headers["content-type"] = "text/csv";
      body = String(input.body ?? "");
    } else if (spec.bodyKind === "multipart") {
      body = new FormData();
      for (const [k, v] of Object.entries(input.body as Record<string, File>)) body.append(k, v);
    }
    if (spec.sse) headers.accept = "text/event-stream";
    let res: Response;
    try {
      res = await fetchImpl(buildUrl(baseUrl, spec.path, input), { method: spec.method, headers, body, signal, credentials: "same-origin" });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ApiClientError(0, "network", "Could not reach the server. Check your connection and try again.");
    }
    if (!res.ok) throw await toError(res);
    return res;
  };

  const json = async <K extends RouteId>(id: K, input: CallInput = {}): Out<K> => {
    const res = await send(id, input);
    const parsed = (routes[id].response as z.ZodType).safeParse(await res.json());
    if (!parsed.success) throw new ApiClientError(502, "invalid_response", "The server answered in an unexpected shape.");
    return parsed.data as RouteOutput<K>;
  };

  async function* stream(id: RouteId, input: CallInput, signal?: AbortSignal): AgentEventStream {
    const res = await send(id, input, signal);
    if (!res.body) throw new ApiClientError(502, "no_stream", "The server did not open a stream.");
    yield* parseSseStream(res.body);
  }

  return {
    getWorkspace: () => json("getWorkspace"),
    putChain: (body) => json("putChain", { body }),
    importStores: (csv) => json("importStores", { body: csv }),
    createStore: (body) => json("createStore", { body }),
    deleteStore: (id) => json("deleteStore", { params: { id } }),
    readMenu: (image) => json("readMenu", { body: { image } }),
    putMenu: (items) => json("putMenu", { body: items }),
    searchAnchors: (q) => json("searchAnchors", { query: { q } }),
    getStoreProfile: (id) => json("getStoreProfile", { params: { id } }),
    compareStores: (a, b) => json("compareStores", { query: { a, b } }),
    buildEditions: (body, o) => stream("buildEditions", { body }, o?.signal),
    regenerateItem: (id, itemId, body = {}, o) => stream("regenerateItem", { params: { id, itemId }, body }, o?.signal),
    listEditions: (weekOf) => json("listEditions", { query: { weekOf } }),
    getEdition: (id) => json("getEdition", { params: { id } }),
    patchItem: (id, itemId, action, version) =>
      json("patchItem", { params: { id, itemId }, headers: { "if-match": formatIfMatch(version) }, body: action }),
    approveAll: (id) => json("approveAll", { params: { id } }),
    getCard: (id) => json("getCard", { params: { id } }),
    getPublicCard: (token) => json("getPublicCard", { params: { token } }),
    runMondayJob: (signature, body = {}) => json("runMondayJob", { headers: { "x-le-signature": signature }, body }),
    getLatestJob: () => json("getLatestJob"),
    getStatus: () => json("getStatus"),
    getProof: () => json("getProof"),
    getLimits: () => json("getLimits"),
    reviewEditions: (body = {}, o) => stream("reviewEditions", { body }, o?.signal),
    generateBrandVoice: () => json("generateBrandVoice", { body: {} }),
    getPendingJobs: (signature) => json("getPendingJobs", { headers: { "x-le-signature": signature } }),
    postJobResults: (signature, body) => json("postJobResults", { headers: { "x-le-signature": signature }, body }),
    postJobEval: (signature, body) => json("postJobEval", { headers: { "x-le-signature": signature }, body }),
  };
}

export function createApiClient(opts: ApiClientOptions = {}): ApiClient {
  const mode = opts.mode ?? clientDataMode();
  if (mode === "mock") return createMockApi({ mockDelayMs: opts.mockDelayMs, mockEventDelayMs: opts.mockEventDelayMs });
  return createHttpApi(opts.baseUrl, opts.fetchImpl);
}

let shared: ApiClient | undefined;
/** App-wide client chosen by NEXT_PUBLIC_DATA_MODE. */
export function getApi(): ApiClient {
  shared ??= createApiClient();
  return shared;
}

/** Collect a stream, calling `onEvent` for each event; resolves with all events. */
export async function consumeEvents(stream: AgentEventStream, onEvent?: (e: AgentEvent) => void): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const e of stream) {
    all.push(e);
    onEvent?.(e);
  }
  return all;
}
