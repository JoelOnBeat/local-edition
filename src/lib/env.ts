import { z } from "zod";

/** Server env, parsed once from process.env. Every key is optional; secrets never leave the server. */

const providerMode = z.enum(["live", "replay", "fixture"]).default("replay");
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

export const ServerEnv = z.object({
  NEBIUS_API_KEY: optionalString,
  TAVILY_API_KEY: optionalString,
  QLOO_API_KEY: optionalString,
  QLOO_MODE: providerMode,
  TF_MODE: providerMode,
  TAVILY_MODE: providerMode,
  SPEND_CAP_USD: z.coerce.number().nonnegative().default(5),
  LE_JOB_SECRET: optionalString,
  GUARDRAILS_URL: z.string().url().default("http://127.0.0.1:8000"),
  STORE_DRIVER: z.enum(["memory", "file", "kv"]).default("file"),
  APP_URL: optionalString,
});
export type ServerEnv = z.infer<typeof ServerEnv>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return ServerEnv.parse(source);
}

let cached: ServerEnv | undefined;

/** Server-only. Cached after first read; use `resetEnvCache` in tests. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

/** Client-safe: inlined by Next at build time. */
export type DataModeSetting = "mock" | "app";
export function clientDataMode(): DataModeSetting {
  return process.env.NEXT_PUBLIC_DATA_MODE === "mock" ? "mock" : "app";
}
