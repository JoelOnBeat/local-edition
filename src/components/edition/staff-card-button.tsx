"use client";

import { useState } from "react";
import { getApi } from "@/lib/api-client";
import { Button } from "../ui";
import { Icon } from "../app-ui/icons";
import { toShownError } from "../lib/use-async";

/** Fetches (or generates) the staff card and opens its public phone page in a new tab. */
export function StaffCardButton({ editionId }: { editionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span role="alert" className="max-w-[220px] text-[13px] leading-5 text-flag">{error}</span> : null}
      <Button data-testid="staff-card" size="sm" variant="secondary" loading={busy} icon={<Icon name="phone" size={14} className="text-faint" />} onClick={async () => {
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
