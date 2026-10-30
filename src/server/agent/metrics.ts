import type { AgentEvent, ModelRole } from "@/contract";
import { asModelUnavailable } from "../http/model-unavailable";
import { estimateTokens } from "../http/spend";
import { MODELS } from "../tokenfactory/models";
import { priceUsd } from "../tokenfactory/spend";
import { AGENT_MODEL, COPY_MODEL, REVIEW_MODEL, type AgentDeps, type ChatClient, type ChatRequest, type ChatResponse } from "./ports";

/**
 * `step_metrics` for every model call: role, model, tool, latency, prompt / cached / completion tokens and
 * dollars. Calls made inside a run push into the run's `StepSink`; the generators drain it between yields,
 * so concurrent copy calls still reach the stream. Dollars use the spend meter's price table, with cached
 * prompt tokens at the catalog's cached rate.
 */

export type StepEvent = Extract<AgentEvent, { type: "step_metrics" }>;

/** USD per million cached prompt tokens (Token Factory catalog, 29 Oct 2026). Models not listed bill cached tokens like fresh ones. */
const CACHED_PER_MTOK: Record<string, number> = {
  [AGENT_MODEL]: 0.06,
  [COPY_MODEL]: 0.03,
  [REVIEW_MODEL]: 0.12,
};

export function stepUsd(model: string, promptTokens: number, cachedTokens: number, completionTokens: number): number {
  const cached = Math.min(Math.max(cachedTokens, 0), promptTokens);
  const cachedRate = CACHED_PER_MTOK[model];
  const cachedCost = cachedRate === undefined ? priceUsd(model, cached, 0) : (cached * cachedRate) / 1_000_000;
  return Math.round((priceUsd(model, promptTokens - cached, completionTokens) + cachedCost) * 1e7) / 1e7;
}

export class StepSink {
  /** The store the next steps belong to; builds set it per store (stores run one after another). */
  storeId?: string;
  /** Every step of the run, for the metrics ledger. */
  readonly all: StepEvent[] = [];
  private queue: StepEvent[] = [];

  push(step: Omit<StepEvent, "type" | "storeId" | "usd"> & { usd?: number }): void {
    const event: StepEvent = {
      type: "step_metrics",
      ...(this.storeId ? { storeId: this.storeId } : {}),
      ...step,
      usd: step.usd ?? stepUsd(step.model, step.promptTokens, step.cachedTokens, step.completionTokens),
    };
    this.queue.push(event);
    this.all.push(event);
  }

  drain(): StepEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

/** Emit whatever the sink collected since the last drain. Safe when the run has no sink. */
export function* flush(deps: Pick<AgentDeps, "sink">): Generator<AgentEvent, void> {
  if (deps.sink) yield* deps.sink.drain();
}

function roleOf(req: ChatRequest): ModelRole {
  if (req.role) return req.role;
  if (req.model === REVIEW_MODEL) return "review";
  return req.model === COPY_MODEL ? "copy" : "agent";
}

function usageOf(req: ChatRequest, res: ChatResponse) {
  if (res.usage) return { promptTokens: res.usage.promptTokens, cachedTokens: res.usage.cachedTokens, completionTokens: res.usage.completionTokens };
  // The provider sent no usage: the spend meter's ~4 characters per token stands in.
  return {
    promptTokens: estimateTokens(req.messages) + estimateTokens(req.tools ?? []),
    cachedTokens: 0,
    completionTokens: estimateTokens(res.content ?? "") + estimateTokens(res.toolCalls),
  };
}

/** Wrap a chat client so each completed call records a step. A failed call records nothing (its usage is unknown). */
export function meterChat(chat: ChatClient, sink: StepSink): ChatClient {
  return {
    async complete(req) {
      const started = Date.now();
      const res = await chat.complete(req);
      const tool = req.tag ?? (res.toolCalls.length ? [...new Set(res.toolCalls.map((c) => c.name))].join("+") : undefined);
      sink.push({ role: roleOf(req), model: req.model, ...(tool ? { tool } : {}), ms: Date.now() - started, ...usageOf(req, res) });
      return res;
    },
  };
}

/** Attach a sink to a run's deps (once). Everything that calls `deps.chat` is then metered. */
export function withMetrics(deps: AgentDeps, sink: StepSink = new StepSink()): AgentDeps {
  return deps.sink ? deps : { ...deps, sink, chat: meterChat(deps.chat, sink) };
}

/** Embeddings through the Token Factory port, recorded as an `embed` step. Usage falls back to the same estimate. */
export async function meteredEmbed(deps: AgentDeps, texts: string[], tool: string) {
  const started = Date.now();
  // A bare 404 from a port that does not name the model is tagged with the embedding model, so the skip note names it.
  const res = await deps.tf.embed(texts).catch((e: unknown) => { throw asModelUnavailable(e, MODELS.embedding) ?? e; });
  deps.sink?.push({ role: "embed", model: MODELS.embedding, tool, ms: Date.now() - started, promptTokens: res.usage?.promptTokens ?? estimateTokens(texts), cachedTokens: 0, completionTokens: 0 });
  return res;
}

/** Rerank through the port (a reranker, or embedding cosine when the reranker is unavailable), recorded as an `embed` step. */
export async function meteredRerank(deps: AgentDeps, query: string, docs: string[], tool: string) {
  const started = Date.now();
  const res = await deps.tf.rerank(query, docs).catch((e: unknown) => { throw asModelUnavailable(e, MODELS.embedding) ?? e; });
  deps.sink?.push({ role: "embed", model: res.method === "rerank" ? MODELS.rerank : MODELS.embedding, tool, ms: Date.now() - started, promptTokens: estimateTokens([query, docs]), cachedTokens: 0, completionTokens: 0 });
  return res;
}
