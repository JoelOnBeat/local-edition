"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { MeResponse } from "@/contract";
import { getApi } from "@/lib/api-client";
import { toShownError } from "../lib/use-async";
import { useSession } from "./session-context";

/**
 * Every "Get started / Sign in / Open" link reads the shared session (no extra request): signed out goes to /signin; signed in goes to
 * /app and says "Open Local Edition"; signed in without finished onboarding goes to /onboarding; a guest on the sample chain goes to /app.
 */
export function startTarget(me: MeResponse | undefined): { href: string; label: string } {
  if (me?.session === "user") return me.onboardingComplete ? { href: "/app", label: "Open Local Edition" } : { href: "/onboarding", label: "Finish setting up" };
  if (me?.session === "guest") return { href: "/app", label: "Back to the sample chain" };
  return { href: "/signin", label: "Sign in" };
}

interface LinkProps {
  className?: string;
  "data-testid"?: string;
  /** Shown when signed out (the default is "Sign in"). */
  signedOutLabel?: ReactNode;
}

export function StartLink({ className, signedOutLabel, ...rest }: LinkProps) {
  const { me } = useSession();
  const target = startTarget(me);
  return (
    <Link href={target.href} className={className} data-testid={rest["data-testid"]} data-session={me?.session ?? "none"}>
      {me?.session ? target.label : (signedOutLabel ?? target.label)}
    </Link>
  );
}

/**
 * "Try the sample chain": makes a real guest session (so the sample passes the same middleware as an account), then opens the app.
 * Someone already signed in just goes to /app.
 */
export function SampleChainLink({ className, signedOutLabel, ...rest }: LinkProps) {
  const router = useRouter();
  const { me, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (me?.session) return <StartLink className={className} data-testid={rest["data-testid"]} />;

  const go = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await getApi().startGuest();
      await refresh();
      router.push("/app");
    } catch (e) {
      setFailed(toShownError(e).message);
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={className} data-testid={rest["data-testid"]} data-session="none" disabled={busy} onClick={() => void go()}>
        {busy ? "Opening..." : (signedOutLabel ?? "Try the sample chain")}
      </button>
      {failed ? <span role="alert" data-testid="sample-error">{failed}</span> : null}
    </>
  );
}
