"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { getApi } from "@/lib/api-client";
import { toShownError, type ShownError } from "../lib/use-async";

/** Sign out and delete account. Both end on the sign-in page; deleting asks for the password again. */
export function useAccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<"signout" | "delete" | null>(null);
  const [error, setError] = useState<ShownError | undefined>();

  const signOut = useCallback(async () => {
    setBusy("signout");
    setError(undefined);
    try {
      await getApi().signOut();
      router.push("/signin");
    } catch (e) {
      setError(toShownError(e));
      setBusy(null);
    }
  }, [router]);

  const deleteAccount = useCallback(
    async (password: string) => {
      setBusy("delete");
      setError(undefined);
      try {
        await getApi().deleteAccount(password);
        router.push("/signin?deleted=1");
      } catch (e) {
        setError(toShownError(e));
        setBusy(null);
      }
    },
    [router],
  );

  return { signOut, deleteAccount, busy, error };
}
