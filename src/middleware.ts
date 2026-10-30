import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPage, isPublicApi, SESSION_COOKIE, signinUrl } from "@/lib/session-paths";

/**
 * First wall of the two: no session cookie means no product page and no data route. It only checks that the cookie exists (Edge cannot
 * read the account store); an expired or forged cookie gets through here and is refused by the handlers (401) and by the client guard in
 * the app layout, which sends it to /signin. The allowlist of open API paths is src/lib/session-paths.ts.
 */
export function middleware(request: NextRequest): NextResponse {
  // The mock data mode (NEXT_PUBLIC_DATA_MODE=mock) has no server and no accounts: the whole app runs in the page, so there is nothing to wall off.
  if (process.env.NEXT_PUBLIC_DATA_MODE === "mock") return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    return NextResponse.json({ error: "Sign in to continue.", code: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  if (isProtectedPage(pathname)) return NextResponse.redirect(new URL(signinUrl(`${pathname}${search}`), request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*", "/app/:path*", "/app", "/onboarding"] };
