import { vi } from "vitest";
import { MemoryRecorder } from "../http/recorder";
import { createTokenFactory, type TfMode, type TokenFactory } from "./client";
import { resetJsonSupportCache } from "./json";
import { TokenFactorySpendMeter } from "./spend";

export const chatBody = (content: string | null, extra: Record<string, unknown> = {}, usage = { prompt_tokens: 100, completion_tokens: 50 }) => ({
  id: "chatcmpl-test",
  model: "test-model",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, ...extra } }],
  usage,
});

export const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

type Handler = (url: string, body: Record<string, unknown>, n: number) => Response | Promise<Response>;

/** A TokenFactory wired to a scripted fetch. Tests only; imports vitest. */
export function scriptedTf(handler: Handler, o: { mode?: TfMode; capUsd?: number } = {}) {
  resetJsonSupportCache();
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const u = String(url);
    calls.push({ url: u, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return handler(u, body, calls.length);
  });
  const meter = new TokenFactorySpendMeter(o.capUsd ?? 5);
  const tf: TokenFactory = createTokenFactory({
    apiKey: "test-key-not-real",
    mode: o.mode ?? "live",
    meter,
    recorder: new MemoryRecorder(),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    random: () => 0.5,
  });
  return { tf, calls, fetchImpl, meter };
}
