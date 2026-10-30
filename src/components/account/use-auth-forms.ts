"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { getApi } from "@/lib/api-client";
import { toShownError, type ShownError } from "../lib/use-async";
import { useSession } from "./session-context";

/**
 * Password sign-up and sign-in as hooks: values, submit, busy and error. The screens only render them, so a redesigned screen reuses all
 * of it. `error.code` is one of AUTH_ERROR_CODES (src/contract/auth.ts); `retryAfterSeconds` is set on a 429.
 * After a success the shared session is re-read before navigating, so the next screen starts from the new session.
 */

export interface FormError extends ShownError {
  retryAfterSeconds?: number;
}

export const asFormError = (e: unknown): FormError => ({ ...toShownError(e), retryAfterSeconds: (e as { retryAfterSeconds?: number })?.retryAfterSeconds });

function useSubmit<V>(initial: V, send: (values: V) => Promise<string>) {
  const router = useRouter();
  const { refresh } = useSession();
  const [values, setValues] = useState<V>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | undefined>();
  const set = useCallback(<K extends keyof V>(key: K, value: V[K]) => setValues((v) => ({ ...v, [key]: value })), []);
  const submit = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const to = await send(values);
      await refresh();
      router.push(to);
    } catch (e) {
      setError(asFormError(e));
      setBusy(false);
    }
  }, [router, refresh, send, values]);
  return { values, set, submit, busy, error };
}

export function useSignupForm() {
  return useSubmit({ name: "", email: "", chainName: "", password: "", keepWorkspace: false }, async (v) => {
    await getApi().signUp(v);
    return "/onboarding";
  });
}

/** `next` is a path under /app (already checked by safeNext) or null. */
export function useSigninForm(next: string | null) {
  return useSubmit({ email: "", password: "" }, async (v) => {
    await getApi().signIn(v);
    if (next) return next;
    return (await getApi().getMe()).onboardingComplete ? "/app" : "/onboarding";
  });
}
