"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MeResponse } from "@/contract";
import { getApi } from "@/lib/api-client";
import { toShownError, type ShownError } from "../lib/use-async";

/**
 * The session, read once per page load (one GET /api/auth/me) and shared by every link, guard and menu that needs it. After anything
 * that changes the session (sign-in, sign-out, the sample chain) the caller awaits `refresh()` before it navigates, so the next screen
 * never starts from a stale answer.
 */
interface SessionValue {
  me: MeResponse | undefined;
  loading: boolean;
  error: ShownError | undefined;
  refresh: () => Promise<MeResponse | undefined>;
  /** Call before signing out on purpose: the app guard then lets the caller choose where to go instead of adding `?next=`. */
  leave: () => void;
  isLeaving: () => boolean;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | undefined>();
  const [error, setError] = useState<ShownError | undefined>();
  const [loading, setLoading] = useState(true);
  const leavingRef = useRef(false);
  const leave = useCallback(() => { leavingRef.current = true; }, []);
  const isLeaving = useCallback(() => leavingRef.current, []);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getApi().getMe();
      if (next.session) leavingRef.current = false; // signed in again: the guard is back on duty
      setMe(next);
      setError(undefined);
      return next;
    } catch (e) {
      setError(toShownError(e));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return; // React strict mode runs effects twice in development: still one request
    started.current = true;
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ me, loading, error, refresh, leave, isLeaving }), [me, loading, error, refresh, leave, isLeaving]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSession needs <SessionProvider> (it is in the root layout).");
  return value;
}
