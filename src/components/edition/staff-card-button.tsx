"use client";

import { useState } from "react";
import { getApi } from "@/lib/api-client";
import { Button } from "../ui";
import { toShownError } from "../lib/use-async";

/** Fetches (or generates) the staff card and opens its public phone page in a new tab. */
export function StaffCardButton({ editionId }: { editionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-[12px] text-flag">{error}</span> : null}
      <Button size="sm" loading={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          const card = await getApi().getCard(editionId);
          window.open(`/card/${card.token}`, "_blank", "noopener");
        } catch (e) {
          setError(toShownError(e).message);
        } finally {
          setBusy(false);
        }
      }}>
        Open staff card
      </Button>
    </span>
  );
}
