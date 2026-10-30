import { HttpError } from "../http/errors";

/**
 * State-changing auth requests must come from this site. The cookies are SameSite=Lax (a cross-site POST or DELETE does not carry
 * them in current browsers), and this is the second wall: a browser that sends `Origin` or `Sec-Fetch-Site` must name us. Requests
 * with neither header (curl, tests, server-to-server) are not browser requests and pass.
 */
export function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new HttpError(403, "bad_origin", "This request did not come from Local Edition.");
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new Set<string>([new URL(request.url).origin]);
  const app = process.env.APP_URL;
  if (app) {
    try {
      allowed.add(new URL(app).origin);
    } catch {
      // a malformed APP_URL adds nothing
    }
  }
  if (!allowed.has(origin)) throw new HttpError(403, "bad_origin", "This request did not come from Local Edition.");
}
