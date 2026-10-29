import { z } from "zod";
import { HttpError } from "@/server/http/errors";

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
  /** HMAC key for /api/jobs/monday. At least MIN_JOB_SECRET_LENGTH characters or the route refuses (503). */
  LE_JOB_SECRET: optionalString,
  GUARDRAILS_URL: z.string().url().default("http://127.0.0.1:8000"),
  /** Shared secret for the guardrails sidecar (header x-le-guard-token). */
  GUARDRAILS_TOKEN: optionalString,
  STORE_DRIVER: z.enum(["memory", "file", "kv", "d1"]).default("file"),
  APP_URL: optionalString,
});
export type ServerEnv = z.infer<typeof ServerEnv>;

/** Shortest accepted LE_JOB_SECRET. Enforced by the jobs route (a short secret refuses with 503, it does not crash other routes). */
export const MIN_JOB_SECRET_LENGTH = 32;

/** In production only durable shared stores are allowed: `memory` and `file` would silently lose or split state. */
const PRODUCTION_DRIVERS: ReadonlyArray<ServerEnv["STORE_DRIVER"]> = ["kv", "d1"];

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const env = ServerEnv.parse(source);
  if ((source.NODE_ENV ?? process.env.NODE_ENV) === "production" && !PRODUCTION_DRIVERS.includes(env.STORE_DRIVER)) {
    throw new HttpError(503, "config_error", "The server is misconfigured: STORE_DRIVER must be kv or d1 in production.");
  }
  return env;
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
