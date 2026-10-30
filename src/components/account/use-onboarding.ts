"use client";

import { useCallback, useState } from "react";
import type { OnboardingState, OnboardingUpdate } from "@/contract";
import { getApi } from "@/lib/api-client";
import { toShownError, useAsync, type ShownError } from "../lib/use-async";

/**
 * Onboarding state and the one write the API has (`updateOnboarding`). The data steps (menu, stores, voice, anchors, tools, build)
 * write through the product's own routes and then call `refresh()`: a step turns done because the data is there, not because a flag was set.
 */
export function useOnboarding() {
  const api = getApi();
  const loaded = useAsync("onboarding", () => api.getOnboarding());
  const [override, setOverride] = useState<OnboardingState | undefined>();
  const [error, setError] = useState<ShownError | undefined>();
  const { reload } = loaded;

  const update = useCallback(
    async (change: OnboardingUpdate) => {
      setError(undefined);
      try {
        setOverride(await api.updateOnboarding(change));
        return true;
      } catch (e) {
        setError(toShownError(e));
        return false;
      }
    },
    [api],
  );
  const refresh = useCallback(() => {
    setOverride(undefined);
    reload();
  }, [reload]);

  return { state: override ?? loaded.data, loading: loaded.loading && !override, error: error ?? loaded.error, update, refresh };
}
