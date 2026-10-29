import { parseCredentials } from "./credentials";
import { createJobsClient, type JobsClient } from "./jobs";
import { createTokenProvider, type TokenCache, type TokenProvider } from "./token";

export * from "./credentials";
export * from "./errors";
export * from "./job-spec";
export * from "./jobs";
export * from "./jwt";
export * from "./schemas";
export * from "./token";

export interface NebiusRestDeps {
  /** The `NEBIUS_SA_CREDENTIALS` Worker secret (the service-account JSON, as one string). */
  credentialsJson: string | undefined;
  /** A KV namespace adapter (`kvTokenCache(env.CACHE)`) or any `{ get, put }`. */
  cache: TokenCache;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Wires credentials, token cache and the jobs client. Throws `NebiusError` `nebius_auth` if the secret is missing or malformed. */
export function createNebiusRest(deps: NebiusRestDeps): { jobs: JobsClient; tokens: TokenProvider } {
  const credentials = parseCredentials(deps.credentialsJson);
  const tokens = createTokenProvider({ credentials, cache: deps.cache, fetchImpl: deps.fetchImpl, now: deps.now });
  return { tokens, jobs: createJobsClient({ tokens, fetchImpl: deps.fetchImpl }) };
}
