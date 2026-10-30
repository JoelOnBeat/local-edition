import type { ParsedToolCall } from "./client";
import { HttpError, UpstreamError } from "../http/errors";

/** ~4 chars per token; images (data URLs) count as a flat 1500 tokens. Used only if the provider omits usage. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const images = (text.match(/data:image\/[a-z+.-]+;base64,/gi) ?? []).length;
  return Math.ceil(text.replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi, "").length / 4) + images * 1500;
}

/** Walk `.cause` so an UpstreamError thrown inside the SDK's fetch is surfaced as itself. */
export function unwrap(e: unknown): Error {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof UpstreamError || cur instanceof HttpError) return cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return new UpstreamError("network", "tokenfactory", "Could not reach Token Factory.", { retryable: true });
}

export function parseToolCall(c: { id: string; function: { name: string; arguments: string } }): ParsedToolCall {
  try {
    const raw = c.function.arguments.trim();
    return { id: c.id, name: c.function.name, arguments: c.function.arguments, args: raw === "" ? {} : JSON.parse(raw) };
  } catch {
    return { id: c.id, name: c.function.name, arguments: c.function.arguments, args: undefined, argsError: "Tool arguments were not valid JSON." };
  }
}

