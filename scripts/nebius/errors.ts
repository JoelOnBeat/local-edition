/**
 * Typed errors for the Nebius REST client. Messages are safe to log and show: they never carry a token,
 * a JWT, a key, a request body or a raw upstream body. `toErrorBody()` is the `{ error, code }` shape
 * every API route returns.
 */

export type NebiusErrorCode =
  | "nebius_auth" // credentials missing/invalid, JWT rejected, token expired or forbidden (401/403, gRPC 7/16)
  | "nebius_quota" // quota or capacity exhausted, rate limited (429, gRPC 8, NotEnoughResources)
  | "nebius_unavailable" // network, timeout, 5xx, gRPC 13/14: retry later
  | "nebius_bad_request" // our request was rejected (400, gRPC 3/9): a bug or bad input, do not retry
  | "nebius_not_found" // 404, gRPC 5
  | "nebius_conflict"; // 409, gRPC 6: a job with this name already exists

export class NebiusError extends Error {
  readonly code: NebiusErrorCode;
  readonly status?: number;
  /** True when the same request may succeed later (unavailable, quota). */
  readonly retryable: boolean;
  /** Nebius's own detail code (`ServiceError.code`, e.g. "PermissionDenied"), when present. */
  readonly nebiusCode?: string;

  constructor(code: NebiusErrorCode, message: string, opts: { status?: number; nebiusCode?: string } = {}) {
    super(message);
    this.name = "NebiusError";
    this.code = code;
    this.status = opts.status;
    this.nebiusCode = opts.nebiusCode;
    this.retryable = code === "nebius_unavailable" || code === "nebius_quota";
  }

  toErrorBody(): { error: string; code: NebiusErrorCode } {
    return { error: this.message, code: this.code };
  }
}

export function isNebiusError(value: unknown): value is NebiusError {
  return value instanceof NebiusError;
}

const SECRETISH = /(Bearer\s+)[A-Za-z0-9._~+/=-]+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*|-----BEGIN [A-Z ]+-----[\s\S]*?(-----END [A-Z ]+-----|$)|[A-Za-z0-9._~+/=-]{40,}/g;

/** Trims an upstream message to a short, token-free line. Upstream text is data, never trusted as safe. */
export function safeMessage(text: unknown, max = 200): string {
  if (typeof text !== "string") return "";
  const cleaned = text.replace(SECRETISH, (_m, bearer: string | undefined) => (bearer ? `${bearer}[redacted]` : "[redacted]"));
  const oneLine = cleaned.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}

interface UpstreamBody {
  /** gRPC status code (Nebius API errors: `{ "code": 3, "message": "..." }`). */
  grpc?: number;
  message: string;
  nebiusCode?: string;
  notEnoughResources: boolean;
}

/** Reads the two Nebius error shapes: API `{code,message,details}` and token endpoint `{status,message,error}`. */
export function readUpstreamBody(text: string): UpstreamBody {
  try {
    const raw: unknown = JSON.parse(text);
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      const details = Array.isArray(o.details) ? (o.details as unknown[]) : [];
      let nebiusCode: string | undefined;
      let notEnoughResources = false;
      for (const d of details) {
        const se = d && typeof d === "object" ? (d as Record<string, unknown>).serviceError : undefined;
        if (se && typeof se === "object") {
          const s = se as Record<string, unknown>;
          if (typeof s.code === "string") nebiusCode = s.code;
          if (s.notEnoughResources) notEnoughResources = true;
        }
      }
      const message = [o.message, o.error_description].find((v) => typeof v === "string" && v) as string | undefined;
      return {
        grpc: typeof o.code === "number" ? o.code : undefined,
        message: safeMessage(message ?? ""),
        nebiusCode,
        notEnoughResources,
      };
    }
  } catch {
    // Not JSON (an HTML gateway page): fall through.
  }
  return { message: safeMessage(text, 120), notEnoughResources: false };
}

const QUOTA_WORDS = /quota|not enough resources|capacity|insufficient|limit exceeded/i;

/** Maps an HTTP failure from the API or the token endpoint onto our codes. */
export function mapHttpError(status: number, bodyText: string, what: string): NebiusError {
  const b = readUpstreamBody(bodyText);
  const opts = { status, nebiusCode: b.nebiusCode };
  const suffix = b.message ? `: ${b.message}` : "";
  const grpc = b.grpc;
  if (status === 401 || status === 403 || grpc === 16 || grpc === 7) {
    return new NebiusError("nebius_auth", `Nebius rejected the credentials for ${what} (HTTP ${status})${suffix}`, opts);
  }
  if (status === 429 || grpc === 8 || b.notEnoughResources || ((status === 400 || status === 412) && QUOTA_WORDS.test(b.message))) {
    return new NebiusError("nebius_quota", `Nebius quota or capacity exhausted for ${what} (HTTP ${status})${suffix}`, opts);
  }
  if (status === 404 || grpc === 5) return new NebiusError("nebius_not_found", `${what} not found${suffix}`, opts);
  if (status === 409 || grpc === 6) return new NebiusError("nebius_conflict", `${what} conflicts with an existing resource${suffix}`, opts);
  if (status >= 500 || grpc === 13 || grpc === 14) {
    return new NebiusError("nebius_unavailable", `Nebius is unavailable for ${what} (HTTP ${status})${suffix}`, opts);
  }
  return new NebiusError("nebius_bad_request", `Nebius rejected ${what} (HTTP ${status})${suffix}`, opts);
}

export function networkError(what: string, timedOut: boolean): NebiusError {
  return new NebiusError("nebius_unavailable", timedOut ? `Nebius timed out for ${what}.` : `Nebius could not be reached for ${what}.`);
}
