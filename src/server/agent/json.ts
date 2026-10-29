import type { z } from "zod";
import { UpstreamError } from "../http/errors";
import type { ChatClient, ChatMessage } from "./ports";

function extractJson(text: string | null): unknown {
  if (!text) return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return undefined; }
}

/**
 * Ask a model for JSON and validate it with zod. JSON mode is unconfirmed for these models, so a
 * bad answer gets one repair turn; after that the caller sees `invalid_response`.
 */
export async function askJson<S extends z.ZodType>(
  chat: ChatClient,
  opts: { model: string; system: string; user: string; schema: S; maxTokens?: number; timeoutMs?: number; temperature?: number },
): Promise<z.output<S>> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat.complete({ model: opts.model, messages, temperature: opts.temperature ?? 0.5, maxTokens: opts.maxTokens ?? 600, timeoutMs: opts.timeoutMs });
    const parsed = opts.schema.safeParse(extractJson(res.content));
    if (parsed.success) return parsed.data;
    const why = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "reply"}: ${i.message}`).join("; ");
    messages.push({ role: "assistant", content: res.content ?? "" });
    messages.push({ role: "user", content: `That was not valid JSON for the requested shape (${why}). Reply with only the JSON object.` });
  }
  throw new UpstreamError("invalid_response", "tokenfactory", "The model did not return the requested JSON.");
}

/** Plain-text completion with quotes and fences stripped. */
export async function askText(
  chat: ChatClient,
  opts: { model: string; system: string; user: string; maxTokens?: number; timeoutMs?: number },
): Promise<string> {
  const res = await chat.complete({ model: opts.model, messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }], temperature: 0.4, maxTokens: opts.maxTokens ?? 300, timeoutMs: opts.timeoutMs });
  const text = (res.content ?? "").replace(/```[a-z]*\n?|```/g, "").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!text) throw new UpstreamError("invalid_response", "tokenfactory", "The model returned no text.");
  return text;
}
