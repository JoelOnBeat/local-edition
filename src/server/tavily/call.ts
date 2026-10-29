import type { z } from "zod";
import { fetchJson, type FetchJsonResult } from "../http/fetch-json";
import { UpstreamError } from "../http/errors";
import type { TavilyRuntime } from "./runtime";

export interface TavilyCall<T> {
  url: string;
  body: unknown;
  schema: z.ZodType<T>;
  /** Replay-miss and fixture-mode stand-in. */
  fixture: () => T;
  /** Credits this call costs when it runs live. */
  credits: number;
  timeoutMs?: number;
}

/** A response we could not read was still billed; every other failure happened before Tavily counted it. */
const BILLED_FAILURES = new Set(["invalid_response", "bad_json"]);

/**
 * The one door to Tavily. Live calls reserve their credits first (TavilyBudgetError when the workspace's
 * day is spent) and give them back if the call failed before it was billed. The key goes in the
 * Authorization header only; replay and fixture runs cost nothing.
 */
export async function callTavily<T>(rt: TavilyRuntime, call: TavilyCall<T>): Promise<FetchJsonResult<T>> {
  const live = rt.run === "live" && Boolean(rt.apiKey);
  if (live) await rt.ledger!.reserve(rt.workspaceId, call.credits);
  try {
    return await fetchJson<T>({
      provider: "tavily",
      method: "POST",
      url: call.url,
      headers: live ? { authorization: `Bearer ${rt.apiKey}` } : undefined,
      body: call.body,
      mode: rt.run,
      schema: call.schema,
      fixture: call.fixture,
      timeoutMs: call.timeoutMs ?? 20_000,
      ...rt.http,
    });
  } catch (e) {
    const billed = e instanceof UpstreamError && BILLED_FAILURES.has(e.code);
    if (live && !billed) await rt.ledger!.refund(rt.workspaceId, call.credits).catch(() => undefined);
    throw e;
  }
}
