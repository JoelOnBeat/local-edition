"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { getApi } from "@/lib/api-client";
import { toShownError, type ShownError } from "../lib/use-async";
import { useSession } from "./session-context";

/** Sign out and delete account. Both end on the sign-in page; deleting asks for the password again. */
export function useAccountActions() {
  const router = useRouter();
  const { refresh, leave } = useSession();
  const [busy, setBusy] = useState<"signout" | "delete" | null>(null);
  const [error, setError] = useState<ShownError | undefined>();

  const signOut = useCallback(async () => {
    setBusy("signout");
    setError(undefined);
    try {
      await getApi().signOut();
      leave();
      await refresh();
      router.push("/signin");
    } catch (e) {
      setError(toShownError(e));
      setBusy(null);
    }
  }, [router, refresh, leave]);

  const deleteAccount = useCallback(
    async (confirm: string | { password?: string; confirmEmail?: string }) => {
      setBusy("delete");
      setError(undefined);
      try {
        await getApi().deleteAccount(confirm);
        leave();
        await refresh();
        router.push("/signin?deleted=1");
      } catch (e) {
        setError(toShownError(e));
        setBusy(null);
      }
    },
    [router, refresh, leave],
  );

  return { signOut, deleteAccount, busy, error };
}
