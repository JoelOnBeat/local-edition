"use client";

import { useCallback } from "react";
import { getApi } from "@/lib/api-client";
import { useAsync } from "../lib/use-async";

/** The workspace bundle the onboarding data steps read and write (chain, stores, menu, latest editions). */
export function useChainBundle() {
  const loaded = useAsync("onboarding:bundle", () => getApi().getWorkspace());
  const { reload } = loaded;
  return { bundle: loaded.data, loading: loaded.loading, error: loaded.error, reload: useCallback(() => reload(), [reload]) };
}
