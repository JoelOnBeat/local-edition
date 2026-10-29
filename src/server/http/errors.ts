/** Typed errors. Messages are safe to show; they never carry upstream bodies, keys or stacks. */

export type UpstreamErrorCode =
  | "rate_limited"
  | "upstream_5xx"
  | "upstream_4xx"
  | "unauthorized"
  | "timeout"
  | "network"
  | "bad_json"
  | "invalid_response"
  | "replay_miss"
  | "no_fixture"
  | "missing_key"
  | "spend_cap";

export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode;
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  /** Machine hint derived from the upstream error body (never the body itself): the provider rejected `response_format`. */
  readonly hint?: "response_format_unsupported";

  constructor(
    code: UpstreamErrorCode,
    provider: string,
    message: string,
    opts: { status?: number; retryable?: boolean; hint?: "response_format_unsupported" } = {},
  ) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.provider = provider;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.hint = opts.hint;
  }
}

/** Throw from a route handler to return a specific status and code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function upstreamHttpStatus(err: UpstreamError): number {
  switch (err.code) {
    case "spend_cap": return 402;
    case "rate_limited": return 429;
    case "timeout": return 504;
    case "missing_key": return 503;
    default: return 502;
  }
}
