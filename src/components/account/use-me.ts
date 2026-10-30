"use client";

import { getApi } from "@/lib/api-client";
import { useAsync } from "../lib/use-async";

/** Who is signed in on this browser (and whether a visitor's sample workspace could be kept). Never creates a workspace. */
export function useMe() {
  const r = useAsync("me", () => getApi().getMe());
  return { me: r.data, loading: r.loading, error: r.error, reload: r.reload };
}
