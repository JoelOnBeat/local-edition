import type { z } from "zod";
import { fetchJson, type FetchJsonResult } from "../http/fetch-json";
import { UpstreamError } from "../http/errors";
import { TavilyBudgetError } from "./budget";
import type { TavilyRuntime } from "./runtime";

export interface TavilyCall<T> {
  url: string;
  body: unknown;
  schema: z.ZodType<T>;
  /** Replay-miss and fixture-mode stand-in. */
  fixture: () => T;
  /** Credits this call costs when it runs live. */
  credits: number;
  /** May this call go out live? (demo workspace, sample query or chain setup; see scope.ts). When false a live run is refused with `tavily_budget`. */
  liveOk: boolean;
  timeoutMs?: number;
}

/** A response we could not read was still billed; every other failure happened before Tavily counted it. */
const BILLED_FAILURES = new Set(["invalid_response", "bad_json"]);

/**
 * The one door to Tavily. A live call must be in scope (`liveOk`), then reserves its credits from the GLOBAL ledger
 * first (TavilyBudgetError when the total or today's slice is spent), and gives them back if the call failed before
 * it was billed. The key goes in the Authorization header only; replay and fixture runs cost nothing.
 */
export async function callTavily<T>(rt: TavilyRuntime, call: TavilyCall<T>): Promise<FetchJsonResult<T>> {
  const live = rt.run === "live" && Boolean(rt.apiKey);
  if (live && !(call.liveOk || rt.allowAnyLive)) throw new TavilyBudgetError("scope");
  const ticket = live ? await rt.ledger!.reserve(call.credits) : null;
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
    if (ticket && !billed) await rt.ledger!.refund(ticket).catch(() => undefined);
    throw e;
  }
}
