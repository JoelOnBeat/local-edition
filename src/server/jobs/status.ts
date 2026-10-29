import type { ProviderMode, ProviderStatus } from "@/contract";
import { serverEnv } from "@/lib/env";
import { getSpendMeter, hasSpendMeter } from "../http/spend";
import { tokenFactoryMeter } from "../tokenfactory/spend";
import type { GuardrailsProbe } from "./ports";

type Mode = "live" | "replay" | "fixture";

function providerMode(mode: Mode, key: string | undefined): ProviderMode {
  return mode === "live" && !key ? "missing-key" : mode;
}

const PROBE_TIMEOUT_MS = 1500;
const PROBE_TTL_MS = 10_000;
let lastProbe: { at: number; url: string; value: "up" | "down" } | undefined;

/** GET <GUARDRAILS_URL>/v1/health with a short timeout, cached for a few seconds. */
export async function probeGuardrailsHttp(url: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<"up" | "down"> {
  if (lastProbe && lastProbe.url === url && now - lastProbe.at < PROBE_TTL_MS) return lastProbe.value;
  let value: "up" | "down" = "down";
  try {
    const res = await fetchImpl(new URL("/v1/health", url), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), cache: "no-store" });
    value = res.ok ? "up" : "down";
  } catch {
    value = "down";
  }
  lastProbe = { at: now, url, value };
  return value;
}
export function resetProbeCache(): void { lastProbe = undefined; }

export async function providerStatus(probe?: GuardrailsProbe): Promise<ProviderStatus> {
  const env = serverEnv();
  if (!hasSpendMeter()) tokenFactoryMeter(); // install the shared Token Factory meter so status reads the same totals the client writes
  const spend = await getSpendMeter(env.SPEND_CAP_USD).totals();
  return {
    qloo: providerMode(env.QLOO_MODE, env.QLOO_API_KEY),
    tokenfactory: providerMode(env.TF_MODE, env.NEBIUS_API_KEY),
    tavily: providerMode(env.TAVILY_MODE, env.TAVILY_API_KEY),
    guardrails: await (probe ?? (() => probeGuardrailsHttp(env.GUARDRAILS_URL)))(),
    spend,
  };
}
