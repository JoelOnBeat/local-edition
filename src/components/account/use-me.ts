"use client";

import { useSession } from "./session-context";

/** Who is signed in on this browser: the shared answer of the page's one /api/auth/me call. */
export function useMe() {
  const { me, loading, error, refresh } = useSession();
  return { me, loading, error, reload: refresh };
}
