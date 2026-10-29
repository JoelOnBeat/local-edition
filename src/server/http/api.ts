import { z } from "zod";
import type { ApiError, RouteSpec } from "@/contract";
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
  /** Raw request text for json/csv bodies (needed for HMAC verification). */
  rawBody: string | null;
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

async function readBody(request: Request, kind: RouteSpec["bodyKind"]): Promise<{ body: unknown; raw: string | null }> {
  if (kind === "none") return { body: undefined, raw: null };
  if (kind === "multipart") {
    const form = await request.formData();
    return { body: Object.fromEntries(form.entries()), raw: null };
  }
  const raw = await request.text();
  if (kind === "csv") return { body: raw, raw };
  if (raw.trim() === "") return { body: {}, raw };
  try {
    return { body: JSON.parse(raw), raw };
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
      if ("body" in shape) {
        const read = await readBody(request, spec.bodyKind);
        raw.body = read.body;
        rawBody = read.raw;
      }
      const input = spec.request.parse(raw) as z.output<S["request"]>;
      const result = await handler(input, { request, rawBody });
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
