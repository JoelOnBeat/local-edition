import { z } from "zod";
import { MENU_IMAGE_MAX_BYTES, type ApiError, type RouteSpec } from "@/contract";
import { createLogger } from "../log";
import { HttpError, UpstreamError, upstreamHttpStatus } from "./errors";

const log = createLogger("api");

/** `{ error, code? }` with a proper status. Never pass raw errors, stacks or upstream bodies here. */
export function apiError(status: number, code: string, message: string): Response {
  const body: ApiError = { error: message, code };
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export interface RouteContext {
  request: Request;
  /** Raw request text for json/csv bodies. */
  rawBody: string | null;
  /** The exact request bytes for json/csv bodies (what an HMAC signs). */
  rawBytes: Uint8Array | null;
}

/** Largest body each kind may carry; larger requests get 413 before anything is parsed. */
export const BODY_LIMITS: Record<RouteSpec["bodyKind"], number> = {
  none: 0,
  json: 256 * 1024,
  csv: 128 * 1024,
  multipart: MENU_IMAGE_MAX_BYTES + 256 * 1024,
};

export interface RouteOptions {
  /** Overrides the default body limit for this route (bytes). */
  maxBodyBytes?: number;
  /**
   * Runs on the raw bytes (already size-capped) BEFORE any JSON parse or schema validation, so an
   * unauthenticated caller cannot make the server parse its input. Throw to reject.
   */
  authenticate?: (input: { request: Request; bytes: Uint8Array }) => void | Promise<void>;
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, "payload_too_large", `The request body is larger than ${Math.round(limit / 1024)} KB.`);
}

/**
 * Reads the body through a counting limiter: `Content-Length` is checked first (413 without reading a
 * byte); chunked or lying requests are cut off the moment they pass the limit.
 */
export async function readLimited(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "invalid_length", "The Content-Length header is not valid.");
    if (n > limit) throw tooLarge(limit);
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

type RouteArgs = { params: Promise<Record<string, string>> } | undefined;

function issueSummary(err: z.ZodError): string {
  return err.issues
    .slice(0, 4)
    .map((i) => `${i.path.length ? i.path.join(".") : "input"}: ${i.message}`)
    .join("; ");
}

/** Maps any thrown value to a safe response. Exported for SSE routes that build their own streams. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return apiError(e.status, e.code, e.message);
  if (e instanceof UpstreamError) return apiError(upstreamHttpStatus(e), e.code, e.message);
  if (e instanceof z.ZodError) return apiError(400, "invalid_input", issueSummary(e));
  log.error("unhandled route error", { err: e });
  return apiError(500, "internal", "Something went wrong on our side.");
}

async function readBody(
  request: Request,
  kind: RouteSpec["bodyKind"],
  opts: RouteOptions,
): Promise<{ body: unknown; raw: string | null; bytes: Uint8Array | null }> {
  if (kind === "none") return { body: undefined, raw: null, bytes: null };
  const bytes = await readLimited(request, opts.maxBodyBytes ?? BODY_LIMITS[kind]);
  await opts.authenticate?.({ request, bytes });
  if (kind === "multipart") {
    const type = request.headers.get("content-type") ?? "";
    let form: FormData;
    try {
      form = await new Response(bytes as BodyInit, { headers: { "content-type": type } }).formData();
    } catch {
      throw new HttpError(400, "invalid_multipart", "The request body is not valid multipart form data.");
    }
    return { body: Object.fromEntries(form.entries()), raw: null, bytes: null };
  }
  const raw = new TextDecoder().decode(bytes);
  if (kind === "csv") return { body: raw, raw, bytes };
  if (raw.trim() === "") return { body: {}, raw, bytes };
  try {
    return { body: JSON.parse(raw), raw, bytes };
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

/**
 * Wrap a route handler: assembles { params, query, headers, body } from the request, validates it
 * with the route's zod request schema, runs the handler and maps every failure to `{ error, code }`.
 * The handler returns data (sent as JSON) or a Response (e.g. from `sseResponse`).
 */
export function withRoute<S extends RouteSpec, R>(
  spec: S,
  handler: (input: z.output<S["request"]>, ctx: RouteContext) => Promise<R | Response> | R | Response,
  options: RouteOptions = {},
): (request: Request, args?: RouteArgs) => Promise<Response> {
  return async (request, args) => {
    try {
      const shape = spec.request.shape as Record<string, unknown>;
      const raw: Record<string, unknown> = {};
      if ("params" in shape) raw.params = args?.params ? await args.params : {};
      if ("query" in shape) raw.query = Object.fromEntries(new URL(request.url).searchParams.entries());
      if ("headers" in shape) {
        const wanted = Object.keys((shape.headers as z.ZodObject).shape);
        raw.headers = Object.fromEntries(wanted.flatMap((h) => (request.headers.has(h) ? [[h, request.headers.get(h)!]] : [])));
      }
      let rawBody: string | null = null;
      let rawBytes: Uint8Array | null = null;
      if ("body" in shape) {
        const read = await readBody(request, spec.bodyKind, options);
        raw.body = read.body;
        rawBody = read.raw;
        rawBytes = read.bytes;
      }
      const input = spec.request.parse(raw) as z.output<S["request"]>;
      const result = await handler(input, { request, rawBody, rawBytes });
      if (result instanceof Response) return result;
      if (process.env.NODE_ENV !== "production" && !spec.sse) {
        const checked = spec.response.safeParse(result);
        if (!checked.success) {
          log.error("response does not match contract", { path: spec.path, issues: issueSummary(checked.error) });
          return apiError(500, "contract_violation", "The response did not match the contract.");
        }
      }
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
