import OpenAI from "openai";
import type { ZodType } from "zod";
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from "openai/resources/chat/completions";
import { UpstreamError } from "../http/errors";
import { fetchJson, type ProviderRunMode } from "../http/fetch-json";
import type { Recorder } from "../http/recorder";
import type { SpendMeter } from "../http/spend";
import { serverEnv } from "@/lib/env";
import { chatFixture, embeddingsFixture, rerankFixture } from "./fixtures";
import { asModelUnavailable, ModelUnavailableError } from "../http/model-unavailable";
import { createModelCatalog, tokenFactoryModelList, type ModelCatalog } from "./catalog";
import { estimateTokens, parseToolCall, unwrap } from "./client-util";
import { MODELS, TF_BASE_URL } from "./models";
import { defaultReasoning, reasoningBody, type Reasoning } from "./reasoning";
import { rerankDocuments, rerankUnavailableMemo, type RerankOutcome } from "./rerank";
import { ChatCompletion, EmbeddingsResponse, RerankResponse } from "./schemas";
import { tokenFactoryMeter } from "./spend";

export { MODELS, TF_BASE_URL };
export type { Reasoning };
export type TfMode = ProviderRunMode;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

export interface ChatOptions {
  model: string;
  tools?: ChatCompletionTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  responseFormat?: ResponseFormat;
  maxTokens: number;
  temperature?: number;
  /**
   * Thinking control: `off`, `low` or `default` (the provider's own). Omitted means the model's tuned default
   * (`defaultReasoning`: off for Lightning copy). `extraBody` still wins over it.
   */
  reasoning?: Reasoning;
  /** Provider-specific passthrough fields (unverified for some models). */
  extraBody?: Record<string, unknown>;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  /** Raw JSON string as sent by the model. */
  arguments: string;
  /** Parsed arguments, or undefined when the model sent invalid JSON (see `argsError`). */
  args: unknown;
  argsError?: string;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ParsedToolCall[];
  finishReason: string | null;
  model: string;
  /** `outTokens` is the provider's completion_tokens, which already includes `reasoningTokens`. */
  usage: { inTokens: number; outTokens: number; reasoningTokens: number };
  mode: TfMode;
  /** The assistant turn, ready to append to `messages` before sending tool results. */
  message: ChatCompletionMessageParam;
}

export interface EmbeddingsResult {
  vectors: number[][];
  model: string;
  mode: TfMode;
}

export interface TokenFactoryOptions {
  apiKey?: string;
  mode?: TfMode;
  baseUrl?: string;
  meter?: SpendMeter;
  recorder?: Recorder;
  timeoutMs?: number;
  retries?: number;
  /**
   * Live mode only. `true` builds the standard catalog (a cached `GET /v1/models`, ten minutes); a catalog object is used as is.
   * A model that the list lacks, or that just answered 404, throws `ModelUnavailableError` without a call. Off by default.
   */
  modelCatalog?: boolean | ModelCatalog;
  // Test seams.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface TokenFactory {
  readonly mode: TfMode;
  chat(messages: ChatCompletionMessageParam[], opts: ChatOptions): Promise<ChatResult>;
  embeddings(texts: string[]): Promise<EmbeddingsResult>;
  rerank(query: string, documents: string[]): Promise<RerankOutcome>;
  /** POST /v1/rerank only, no fallback. */
  rawRerank(query: string, documents: string[]): Promise<{ scores: { index: number; score: number }[]; mode: TfMode }>;
}

const EMBED_BATCH = 64;
const MODE_HEADER = "x-le-mode";

export function createTokenFactory(opts: TokenFactoryOptions = {}): TokenFactory {
  const mode: TfMode = opts.mode ?? "replay";
  const baseUrl = (opts.baseUrl ?? TF_BASE_URL).replace(/\/?$/, "/");
  const meter = opts.meter ?? tokenFactoryMeter();
  const catalog: ModelCatalog | null =
    mode !== "live" || !opts.modelCatalog ? null
    : opts.modelCatalog === true ? createModelCatalog({ list: tokenFactoryModelList({ baseUrl, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl }) })
    : opts.modelCatalog;

  /** Refuses a call to a model that is known to be gone (not listed, or 404 within ten minutes) before any request or spend. */
  async function requireAvailable(model: string): Promise<void> {
    if (catalog && !(await catalog.available(model))) throw new ModelUnavailableError(model, "not_listed");
  }
  /** A 404 / `model_not_found` becomes `ModelUnavailableError` (and is remembered); anything else passes through untouched. */
  function classify(e: Error, model: string): Error {
    const gone = asModelUnavailable(e, model);
    if (gone) catalog?.markGone(model);
    return gone ?? e;
  }

  async function send<T>(args: {
    url: string;
    body: Record<string, unknown>;
    schema: ZodType<T>;
    fixture: () => T;
    usage: (d: T) => { model: string; inTokens: number; outTokens: number };
    authorization?: string;
  }) {
    if (mode === "live" && !opts.apiKey) throw new UpstreamError("missing_key", "tokenfactory", "NEBIUS_API_KEY is not set.");
    return fetchJson<T>({
      provider: "tokenfactory",
      method: "POST",
      url: args.url,
      headers: { ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
      body: args.body,
      mode,
      schema: args.schema,
      fixture: args.fixture,
      usage: args.usage,
      meter,
      recorder: opts.recorder,
      timeoutMs: opts.timeoutMs ?? 120_000,
      retries: opts.retries,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      random: opts.random,
    });
  }

  /** The SDK builds and parses requests; this fetch hands the wire call to our http layer. */
  const bridge = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as Record<string, unknown>;
    const model = String(body.model ?? MODELS.copy);
    const path = new URL(url).pathname;
    let res: { data: unknown; mode: TfMode };
    if (path.endsWith("/chat/completions")) {
      res = await send({
        url, body, schema: ChatCompletion, fixture: () => chatFixture(body),
        usage: (d) => ({
          model,
          inTokens: d.usage?.prompt_tokens ?? estimateTokens(body.messages),
          outTokens: d.usage?.completion_tokens ?? estimateTokens(d.choices[0]?.message.content),
        }),
      });
    } else if (path.endsWith("/embeddings")) {
      res = await send({
        url, body, schema: EmbeddingsResponse, fixture: () => embeddingsFixture(body),
        usage: (d) => ({ model, inTokens: d.usage?.prompt_tokens ?? estimateTokens(body.input), outTokens: 0 }),
      });
    } else {
      throw new UpstreamError("upstream_4xx", "tokenfactory", "Unsupported Token Factory path.");
    }
    return new Response(JSON.stringify(res.data), { status: 200, headers: { "content-type": "application/json", [MODE_HEADER]: res.mode } });
  }) as typeof fetch;

  const sdk = new OpenAI({
    apiKey: opts.apiKey ?? "no-key-replay-or-fixture-mode",
    baseURL: baseUrl,
    fetch: bridge,
    maxRetries: 0,
    timeout: 10 * 60_000,
  });

  const modeOf = (response: Response): TfMode => (response.headers.get(MODE_HEADER) as TfMode | null) ?? mode;

  async function chat(messages: ChatCompletionMessageParam[], o: ChatOptions): Promise<ChatResult> {
    const params = {
      model: o.model,
      messages,
      max_tokens: o.maxTokens,
      ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
      ...(o.tools?.length ? { tools: o.tools } : {}),
      ...(o.toolChoice !== undefined && o.tools?.length ? { tool_choice: o.toolChoice } : {}),
      ...(o.responseFormat ? { response_format: o.responseFormat } : {}),
      ...reasoningBody(o.model, o.reasoning ?? defaultReasoning(o.model, Boolean(o.tools?.length))),
      ...o.extraBody,
    } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
    await requireAvailable(o.model);
    try {
      const { data, response } = await sdk.chat.completions.create(params).withResponse();
      const parsed = ChatCompletion.parse(data);
      const m = parsed.choices[0];
      const toolCalls = (m.message.tool_calls ?? []).map(parseToolCall);
      const content = m.message.content ?? null;
      return {
        content,
        toolCalls,
        finishReason: m.finish_reason ?? null,
        model: parsed.model ?? o.model,
        usage: {
          inTokens: parsed.usage?.prompt_tokens ?? 0,
          outTokens: parsed.usage?.completion_tokens ?? 0,
          reasoningTokens: parsed.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        },
        mode: modeOf(response),
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length
            ? { tool_calls: toolCalls.map((t) => ({ id: t.id, type: "function" as const, function: { name: t.name, arguments: t.arguments } })) }
            : {}),
        },
      };
    } catch (e) {
      throw classify(unwrap(e), o.model);
    }
  }

  async function embeddings(texts: string[]): Promise<EmbeddingsResult> {
    await requireAvailable(MODELS.embedding);
    const vectors: number[][] = [];
    let last: TfMode = mode;
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH).map((t) => (t.trim() === "" ? " " : t));
      try {
        const { data, response } = await sdk.embeddings
          .create({ model: MODELS.embedding, input: batch, encoding_format: "float" })
          .withResponse();
        const parsed = EmbeddingsResponse.parse(data);
        if (parsed.data.length !== batch.length) {
          throw new UpstreamError("invalid_response", "tokenfactory", "Token Factory returned the wrong number of embeddings.");
        }
        for (const row of [...parsed.data].sort((a, b) => a.index - b.index)) vectors.push(row.embedding);
        last = modeOf(response);
      } catch (e) {
        throw classify(unwrap(e), MODELS.embedding);
      }
    }
    return { vectors, model: MODELS.embedding, mode: last };
  }

  async function rawRerank(query: string, documents: string[]) {
    const body = { model: MODELS.rerank, query, documents };
    await requireAvailable(MODELS.rerank);
    const r = await send({
      url: `${baseUrl}rerank`, body, schema: RerankResponse, fixture: () => rerankFixture(body),
      usage: (d) => ({ model: MODELS.rerank, inTokens: d.usage?.prompt_tokens ?? estimateTokens([query, documents]), outTokens: 0 }),
    }).catch((e: Error) => { throw classify(e, MODELS.rerank); });
    const scores = r.data.results
      .filter((x) => x.index < documents.length)
      .map((x) => ({ index: x.index, score: x.relevance_score }))
      .sort((a, b) => b.score - a.score);
    return { scores, mode: r.mode };
  }

  const probedRerank = rerankUnavailableMemo(rawRerank);

  const tf: TokenFactory = {
    mode,
    chat,
    embeddings,
    rawRerank,
    rerank: (query, documents) => rerankDocuments({ mode, embeddings, rawRerank: probedRerank }, query, documents),
  };
  return tf;
}

/** Effective mode: TF_MODE, but `live` without a key degrades to `replay` (status shows `missing-key`). */
export function resolveTfMode(env = serverEnv()): { mode: TfMode; keyMissing: boolean } {
  const keyMissing = !env.NEBIUS_API_KEY;
  return { mode: env.TF_MODE === "live" && keyMissing ? "replay" : env.TF_MODE, keyMissing };
}

let shared: TokenFactory | undefined;

/** Process-wide client built from env. Tests and other streams may swap it with `setTokenFactory`. */
export function getTokenFactory(): TokenFactory {
  if (!shared) {
    const env = serverEnv();
    shared = createTokenFactory({ apiKey: env.NEBIUS_API_KEY, mode: resolveTfMode(env).mode, modelCatalog: true });
  }
  return shared;
}
export function setTokenFactory(tf: TokenFactory | undefined): void {
  shared = tf;
}
