import { platformEnvSync } from "../platform/env";

/**
 * Production (NODE_ENV=production, or any Worker with the app's bindings) is live-only: replay, fixture and recording fallbacks are
 * unreachable there, whatever QLOO_MODE says (Gabriel, 30 Oct 23:02 MYT: "no more mocks ever"). Dev and unit tests keep them.
 */
export function qlooLiveOnly(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(platformEnvSync()?.LE_DB);
}

