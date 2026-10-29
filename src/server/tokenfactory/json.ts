import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { UpstreamError } from "../http/errors";
import { createLogger } from "../log";
import type { ChatResult, ResponseFormat, TfMode, TokenFactory } from "./client";

const log = createLogger("tf-json");

/** Thrown when the model's output still fails the schema after the single repair retry. */
export class ModelJsonError extends UpstreamError {
  readonly issues: string[];
  constructor(issues: string[]) {
    super("invalid_response", "tokenfactory", "The model did not return valid structured output.");
    this.name = "ModelJsonError";
    this.issues = issues;
  }
}

export interface JsonCall {
  tf: TokenFactory;
  model: string;
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
  /** Model for the repair call; defaults to `model`. */
  repairModel?: string;
  /** Name passed in the json_schema response_format. */
  name?: string;
  extraBody?: Record<string, unknown>;
}

export interface JsonResult<T> {
  data: T;
  mode: TfMode;
  /** Chat calls made: 1 = first try, 2 = fallback or repair, 3 = both. */
  calls: number;
  repaired: boolean;
  usage: { inTokens: number; outTokens: number };
}

/** Per-model memory of whether `response_format: json_schema` was rejected, so we stop paying for 400s. */
const schemaUnsupported = new Set<string>();
export function resetJsonSupportCache(): void {
  schemaUnsupported.clear();
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  try {
    const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
    void _ignored;
    return rest;
  } catch {
    return { type: "object" };
  }
}

/** Parse model text into a JSON value: drops reasoning blocks and code fences, then finds the first balanced value. */
export function extractJson(text: string): unknown {
  let t = text;
  const close = t.lastIndexOf("</think>");
  if (close >= 0) t = t.slice(close + "</think>".length);
  t = t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through to scanning
  }
  const start = t.search(/[{[]/);
  if (start < 0) throw new SyntaxError("no JSON value found");
  const open = t[start];
  const closeCh = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === closeCh && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new SyntaxError("unterminated JSON value");
}

function issuesOf(e: unknown): string[] {
  if (e instanceof z.ZodError) return e.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return [e instanceof Error ? e.message : "invalid JSON"];
}

function withSchemaPrompt(messages: ChatCompletionMessageParam[], jsonSchema: Record<string, unknown>): ChatCompletionMessageParam[] {
  const rule =
    "Reply with a single JSON value only: no prose, no code fences, no reasoning text. " +
    `It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  const [first, ...rest] = messages;
  if (first?.role === "system" && typeof first.content === "string") return [{ role: "system", content: `${first.content}\n\n${rule}` }, ...rest];
  return [{ role: "system", content: rule }, ...messages];
}

function tryParse<T>(schema: z.ZodType<T>, content: string | null): { ok: true; data: T } | { ok: false; issues: string[] } {
  if (!content || content.trim() === "") return { ok: false, issues: ["empty response"] };
  try {
    const r = schema.safeParse(extractJson(content));
    return r.success ? { ok: true, data: r.data } : { ok: false, issues: issuesOf(r.error) };
  } catch (e) {
    return { ok: false, issues: issuesOf(e) };
  }
}

/**
 * Structured output from a model whose JSON mode is unconfirmed.
 * 1. `response_format: json_schema`; if the provider rejects it (HTTP 4xx), schema-in-prompt instead.
 * 2. Parse and validate with zod. On failure, ONE repair call that shows the model its output and the errors.
 * 3. Still invalid: throw ModelJsonError (an UpstreamError, code `invalid_response`).
 */
export async function jsonOutput<T>(schema: z.ZodType<T>, call: JsonCall): Promise<JsonResult<T>> {
  const jsonSchema = jsonSchemaOf(schema);
  const base = { maxTokens: call.maxTokens, temperature: call.temperature ?? 0, extraBody: call.extraBody };
  const usage = { inTokens: 0, outTokens: 0 };
  let calls = 0;
  const run = async (model: string, messages: ChatCompletionMessageParam[], responseFormat?: ResponseFormat) => {
    calls++;
    const r: ChatResult = await call.tf.chat(messages, { ...base, model, responseFormat });
    usage.inTokens += r.usage.inTokens;
    usage.outTokens += r.usage.outTokens;
    return r;
  };

  let first: ChatResult | undefined;
  if (!schemaUnsupported.has(call.model)) {
    try {
      first = await run(
        call.model,
        call.messages,
        { type: "json_schema", json_schema: { name: call.name ?? "result", schema: jsonSchema } },
      );
    } catch (e) {
      if (!(e instanceof UpstreamError) || e.code !== "upstream_4xx") throw e;
      log.warn("json_schema response_format rejected; using schema-in-prompt", { model: call.model, status: e.status });
      schemaUnsupported.add(call.model);
    }
  }
  first ??= await run(call.model, withSchemaPrompt(call.messages, jsonSchema));

  const parsed = tryParse(schema, first.content);
  if (parsed.ok) return { data: parsed.data, mode: first.mode, calls, repaired: false, usage };

  const repair = await run(call.repairModel ?? call.model, withSchemaPrompt([
    { role: "system", content: "You repair malformed JSON. Output only the corrected JSON value." },
    {
      role: "user",
      content: `Your previous output was invalid.\nProblems:\n- ${parsed.issues.join("\n- ")}\n\nPrevious output:\n${(first.content ?? "").slice(0, 8000)}\n\nReturn the corrected JSON only.`,
    },
  ], jsonSchema));
  const fixed = tryParse(schema, repair.content);
  if (fixed.ok) return { data: fixed.data, mode: repair.mode, calls, repaired: true, usage };
  log.warn("model JSON failed after repair", { model: call.model, issues: fixed.issues });
  throw new ModelJsonError(fixed.issues);
}
