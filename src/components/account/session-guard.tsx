"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { signinUrl } from "@/lib/session-paths";
import { useSession } from "./session-context";

/**
 * Second wall of the two (the first is src/middleware.ts, which only sees that a cookie exists): the app layout asks the shared session
 * and sends an expired, revoked or forged cookie to /signin?next=<this page>. Children render only once the session is known to be good,
 * so no data request goes out with a dead cookie.
 */
export function SessionGuard({ children }: { children: ReactNode }) {
  const { me, loading, error, isLeaving } = useSession();
  const router = useRouter();
  const pathname = usePathname() ?? "/app";
  const ok = Boolean(me?.session);

  useEffect(() => {
    if (!loading && !error && !ok && !isLeaving()) router.replace(signinUrl(`${pathname}${typeof window === "undefined" ? "" : window.location.search}`));
  }, [loading, error, ok, router, pathname, isLeaving]);

  if (ok) return <>{children}</>;
  if (error) return <p role="alert" data-testid="session-error">{error.message}</p>;
  return <p data-testid="session-checking">Checking your session...</p>;
}
