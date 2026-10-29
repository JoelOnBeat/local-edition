import menuBoard from "../../../fixtures/tokenfactory/menu-board.json";
import chatText from "../../../fixtures/tokenfactory/chat-text.json";
import type { ChatCompletion, EmbeddingsResponse, RerankResponse } from "./schemas";
import { MODELS } from "./models";
import { cosine } from "./vector";

/**
 * Synthetic stand-ins for replay misses and fixture mode. Deterministic, derived from the request,
 * and clearly fake: they let the whole app run before a Nebius key exists.
 */

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

// ---- embeddings: hashed bag-of-words, so cosine fallback still ranks sensibly -------------------

export const FIXTURE_DIM = 64;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashEmbedding(text: string, dim = FIXTURE_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const h = fnv1a(w);
    v[h % dim] += (h >>> 16) & 1 ? 1 : -1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export function embeddingsFixture(body: Json): EmbeddingsResponse {
  const input = Array.isArray(body.input) ? (body.input as unknown[]) : [body.input];
  const texts = input.map((t) => String(t ?? ""));
  return {
    model: String(body.model ?? MODELS.embedding),
    data: texts.map((t, index) => ({ index, embedding: hashEmbedding(t) })),
    usage: { prompt_tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0), total_tokens: 0 },
  };
}

export function rerankFixture(body: Json): RerankResponse {
  const docs = (Array.isArray(body.documents) ? body.documents : []).map((d) => String(d ?? ""));
  const q = hashEmbedding(String(body.query ?? ""));
  const results = docs
    .map((d, index) => ({ index, relevance_score: Number(Math.max(0, cosine(q, hashEmbedding(d))).toFixed(4)) }))
    .sort((a, b) => b.relevance_score - a.relevance_score);
  return { model: String(body.model ?? MODELS.rerank), results, usage: { prompt_tokens: 0, total_tokens: 0 } };
}

// ---- chat -----------------------------------------------------------------------------------

/** Minimal JSON Schema -> sample value (respects enum, min/max, required-ness is ignored: all props filled). */
export function sampleFromJsonSchema(schema: unknown, depth = 0): unknown {
  const s = asObj(schema);
  if (depth > 6) return null;
  if ("const" in s) return s.const;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const union = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(union) && union.length) {
    const pick = union.find((u) => asObj(u).type !== "null") ?? union[0];
    return sampleFromJsonSchema(pick, depth + 1);
  }
  const type = Array.isArray(s.type) ? (s.type as string[]).find((t) => t !== "null") : s.type;
  switch (type) {
    case "string": {
      const min = Number(s.minLength ?? 1);
      const max = Number(s.maxLength ?? 200);
      return "sample text".padEnd(Math.max(min, 1), "x").slice(0, max);
    }
    case "integer":
    case "number": {
      const lo = typeof s.minimum === "number" ? s.minimum : typeof s.exclusiveMinimum === "number" ? s.exclusiveMinimum + 1 : 0;
      return type === "integer" ? Math.ceil(lo) : lo;
    }
    case "boolean": return false;
    case "array": {
      const n = Math.max(Number(s.minItems ?? 1), 1);
      return Array.from({ length: n }, () => sampleFromJsonSchema(s.items, depth + 1));
    }
    case "object": {
      const props = asObj(s.properties);
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sampleFromJsonSchema(v, depth + 1)]));
    }
    default: return null;
  }
}

function hasImage(messages: unknown[]): boolean {
  return messages.some((m) => Array.isArray(asObj(m).content) && (asObj(m).content as unknown[]).some((p) => asObj(p).type === "image_url"));
}

function textReply(content: string, model: string): ChatCompletion {
  return {
    id: "chatcmpl-fixture",
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 40, completion_tokens: Math.ceil(content.length / 4) },
  };
}

export function chatFixture(body: Json): ChatCompletion {
  const model = String(body.model ?? MODELS.copy);
  const messages = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
  if (hasImage(messages)) return { ...(menuBoard as ChatCompletion), model };

  const tools = Array.isArray(body.tools) ? (body.tools as Json[]) : [];
  const choice = body.tool_choice;
  const toolResultSeen = messages.some((m) => asObj(m).role === "tool");
  if (tools.length && choice !== "none" && !toolResultSeen) {
    const named = asObj(asObj(choice).function).name;
    const tool = tools.find((t) => asObj(t.function).name === named) ?? tools[0];
    const fn = asObj(tool.function);
    return {
      id: "chatcmpl-fixture-tool",
      model,
      choices: [{
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_fixture_1",
            type: "function",
            function: { name: String(fn.name), arguments: JSON.stringify(sampleFromJsonSchema(fn.parameters ?? { type: "object", properties: {} })) },
          }],
        },
      }],
      usage: { prompt_tokens: 60, completion_tokens: 20 },
    };
  }

  const rf = asObj(body.response_format);
  if (rf.type === "json_schema") {
    return textReply(JSON.stringify(sampleFromJsonSchema(asObj(rf.json_schema).schema)), model);
  }
  if (rf.type === "json_object") return textReply("{}", model);
  return { ...(chatText as ChatCompletion), model };
}
