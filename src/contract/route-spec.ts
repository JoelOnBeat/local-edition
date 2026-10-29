import type { z } from "zod";

/** Shape of one entry in the route tables (routes.ts and routes-upgrade.ts). */

/** Owning backend stream: A-E per docs/BUILD.md, S2-S5 are the upgrade workflow's streams. */
export type StreamOwner = "A" | "B" | "C" | "E" | "S2" | "S3" | "S4" | "S5";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type BodyKind = "none" | "json" | "csv" | "multipart";

export interface RouteSpec {
  method: HttpMethod;
  /** Next.js style with `:param` segments. */
  path: string;
  /** Owning backend stream. */
  stream: StreamOwner;
  bodyKind: BodyKind;
  /** Shape of the input: any of { params, query, headers, body }. */
  request: z.ZodObject;
  /** JSON response schema, or the single event schema when `sse` is true. */
  response: z.ZodType;
  /** True when the response is a text/event-stream of `response` events. */
  sse: boolean;
}
