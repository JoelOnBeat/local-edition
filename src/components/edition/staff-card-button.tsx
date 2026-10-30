"use client";

import { useCallback, useEffect, useState } from "react";
import { getApi } from "@/lib/api-client";
import { Button, buttonClass } from "../ui";
import { Icon } from "../app-ui/icons";
import { toShownError } from "../lib/use-async";

type Phase = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error"; message: string };

/**
 * The staff card of an approved edition: a visible "Staff card" button, then its public link with Copy link and Open. The card
 * is read (or written, the first time) as soon as the edition is fully approved, so the link is already there when head office
 * looks for it; Open is a plain link to the public phone page (/card/<token>), which needs no sign-in, so it also works from
 * a message or a QR code. A failure keeps the button, which tries again.
 */
export function StaffCardButton({ editionId }: { editionId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const card = await getApi().getCard(editionId);
      setPhase({ kind: "ready", url: `${window.location.origin}/card/${card.token}` });
    } catch (e) {
      setPhase({ kind: "error", message: toShownError(e).message });
    }
  }, [editionId]);

  useEffect(() => {
    // The card for this edition is read once the page shows it; state is set from the answer, not from the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };

  const ready = phase.kind === "ready" ? phase.url : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="staff-card-group" data-state={phase.kind}>
      {phase.kind === "error" ? <span role="alert" className="max-w-[220px] text-[13px] leading-5 text-flag">{phase.message}</span> : null}
      <Button
        data-testid="staff-card"
        size="sm"
        variant="secondary"
        loading={phase.kind === "loading"}
        icon={<Icon name="phone" size={14} className="text-faint" />}
        onClick={() => { if (ready) window.open(ready, "_blank", "noopener"); else void load(); }}
      >
        Staff card
      </Button>
      {ready ? (
        <>
          <button type="button" data-testid="staff-card-copy" onClick={() => void copy(ready)} className={buttonClass("secondary", "sm")}>
            <Icon name={copied === "copied" ? "check" : "link"} size={14} className="text-faint" />
            {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy link"}
          </button>
          <a data-testid="staff-card-open" href={ready} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
            <Icon name="external" size={14} className="text-faint" />
            Open
          </a>
        </>
      ) : null}
    </span>
  );
}
