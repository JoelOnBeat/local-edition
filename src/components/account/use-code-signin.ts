"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CODE_LENGTH } from "@/contract";
import { getApi } from "@/lib/api-client";
import { asFormError, type FormError } from "./use-auth-forms";
import { useSession } from "./session-context";

/**
 * Sign-in by emailed one-time code: email, then the code, with resend (after the cooldown) and change-email. Signing in and signing up
 * are the same step: an address with no account gets one when its first code is verified.
 * `unavailable` turns true when the server cannot send mail (`email_unavailable`): the screen then offers the password form.
 */
export function useCodeSignin(next: string | null) {
  const router = useRouter();
  const { refresh, me } = useSession();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCodeState] = useState("");
  const [keepWorkspace, setKeepWorkspace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | undefined>();
  const [cooldown, setCooldown] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /** Keeps digits only, at most CODE_LENGTH: what a paste of "123 456" or "123-456" should leave behind. */
  const setCode = useCallback((raw: string) => setCodeState(raw.replace(/\D/g, "").slice(0, CODE_LENGTH)), []);

  const send = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const sent = await getApi().requestCode(email);
      setCooldown(sent.resendAfterSeconds);
      setCodeState("");
      setStep("code");
    } catch (e) {
      const err = asFormError(e);
      if (err.code === "email_unavailable") setUnavailable(true);
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [email]);

  const verify = useCallback(
    async (typed?: string) => {
      setBusy(true);
      setError(undefined);
      try {
        const result = await getApi().verifyCode({ email, code: typed ?? code, keepWorkspace });
        await refresh();
        const finished = (await getApi().getMe()).onboardingComplete;
        router.push(result.created ? "/onboarding" : (next ?? (finished ? "/app" : "/onboarding")));
      } catch (e) {
        setError(asFormError(e));
        setBusy(false);
      }
    },
    [email, code, keepWorkspace, next, refresh, router],
  );

  const changeEmail = useCallback(() => {
    setStep("email");
    setCodeState("");
    setError(undefined);
    setCooldown(0);
  }, []);

  return { step, email, setEmail, code, setCode, keepWorkspace, setKeepWorkspace, canKeep: Boolean(me?.canKeepWorkspace), busy, error, cooldown, unavailable, send, verify, resend: send, changeEmail };
}
