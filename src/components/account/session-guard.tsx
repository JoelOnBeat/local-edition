"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { signinUrl } from "@/lib/session-paths";
import { LogoMark, Spinner } from "@/components/ui";
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
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
      <LogoMark size={28} />
      {error ? (
        <p role="alert" data-testid="session-error" className="max-w-[360px] text-[14px] leading-5 text-flag">{error.message}</p>
      ) : (
        <p data-testid="session-checking" className="inline-flex items-center gap-2 text-[14px] leading-5 text-muted">
          <Spinner className="size-3.5" />
          Checking your session…
        </p>
      )}
    </div>
  );
}
