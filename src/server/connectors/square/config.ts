import { z } from "zod";
import { HttpError } from "../../http/errors";
import type { ProviderRunMode } from "../../http/fetch-json";

/**
 * Square settings, read from the environment (Worker secrets in production, .env.local under `next dev`).
 * Secrets: SQUARE_ACCESS_TOKEN (the sample chain's sandbox token), SQUARE_APP_ID and SQUARE_APP_SECRET (OAuth application),
 * SQUARE_WEBHOOK_SIGNATURE_KEY (the subscription's signature key), SQUARE_TOKEN_KEY (AES key for tokens at rest).
 */

/** Pinned on every request (the header Square-Version), never "latest": a Square release must not change our parsing. */
export const SQUARE_VERSION = "2026-09-16";
export const SQUARE_SANDBOX_BASE = "https://connect.squareupsandbox.com";
export const SQUARE_PRODUCTION_BASE = "https://connect.squareup.com";
/** Scopes a real chain grants: read the catalog, publish specials, read the merchant, read orders (sold counts). */
export const SQUARE_OAUTH_SCOPES = ["ITEMS_READ", "ITEMS_WRITE", "MERCHANT_PROFILE_READ", "ORDERS_READ"] as const;
/** Our own items carry this SKU prefix; the menu import skips them so a published special never becomes a base menu item. */
export const SPECIAL_SKU_PREFIX = "LE-";
export const DEFAULT_APP_URL = "https://localedition.pages.dev";

const opt = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());
const Env = z.object({
  SQUARE_MODE: z.enum(["live", "replay", "fixture"]).default("live"),
  SQUARE_ACCESS_TOKEN: opt,
  SQUARE_APP_ID: opt,
  SQUARE_APP_SECRET: opt,
  SQUARE_WEBHOOK_SIGNATURE_KEY: opt,
  SQUARE_TOKEN_KEY: opt,
  /** `sandbox` or `production`; defaults from the application id (sandbox ids start `sandbox-`). */
  SQUARE_OAUTH_ENV: z.enum(["sandbox", "production"]).optional(),
  APP_URL: opt,
});

export interface SquareConfig {
  mode: ProviderRunMode;
  sandboxToken?: string;
  appId?: string;
  appSecret?: string;
  webhookKey?: string;
  tokenKey?: string;
  oauthEnv: "sandbox" | "production";
  appUrl: string;
  /** Exactly the URL registered with Square: the signature covers it, so it is never read from the incoming request (a proxy rewrites hosts). */
  webhookUrl: string;
  redirectUrl: string;
}

export function readSquareConfig(source: Record<string, string | undefined> = process.env): SquareConfig {
  const env = Env.parse(source);
  const appUrl = (env.APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, "");
  return {
    mode: env.SQUARE_MODE,
    sandboxToken: env.SQUARE_ACCESS_TOKEN,
    appId: env.SQUARE_APP_ID,
    appSecret: env.SQUARE_APP_SECRET,
    webhookKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    tokenKey: env.SQUARE_TOKEN_KEY,
    oauthEnv: env.SQUARE_OAUTH_ENV ?? (env.SQUARE_APP_ID?.startsWith("sandbox-") ? "sandbox" : "production"),
    appUrl,
    webhookUrl: `${appUrl}/api/connectors/square/webhook`,
    redirectUrl: `${appUrl}/api/connectors/square/callback`,
  };
}

export const baseUrl = (env: "sandbox" | "production"): string => (env === "sandbox" ? SQUARE_SANDBOX_BASE : SQUARE_PRODUCTION_BASE);

export function requireSandboxToken(config: SquareConfig): string {
  if (!config.sandboxToken) throw new HttpError(503, "square_not_configured", "The Square sandbox is not set up on this server yet.");
  return config.sandboxToken;
}

export function requireOAuthApp(config: SquareConfig): { appId: string; appSecret: string } {
  if (!config.appId || !config.appSecret) throw new HttpError(503, "square_oauth_not_configured", "Connecting your own Square account is not set up on this server yet.");
  return { appId: config.appId, appSecret: config.appSecret };
}

/** The Square dashboard page for a catalog item; null when the id is missing. Best effort: Square can move its dashboard. */
export function itemDashboardUrl(env: "sandbox" | "production", itemId: string): string {
  return `${env === "sandbox" ? "https://squareupsandbox.com" : "https://squareup.com"}/dashboard/items/library/${encodeURIComponent(itemId)}`;
}
