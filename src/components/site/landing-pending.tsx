"use client";

import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";

/** Neutral stand-in when this week's sample editions are not readable yet. It shows no numbers; Retry reads them again. */
export function SamplePending({ className, dark }: { className?: string; dark?: boolean }) {
  const router = useRouter();
  return (
    <p data-testid="sample-pending" className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] leading-5", dark ? "text-band-ink-3" : "text-muted", className)}>
      Loading this week&apos;s sample editions…
      <button type="button" onClick={() => router.refresh()} className={cx("font-medium underline underline-offset-[3px]", dark ? "text-band-ink-2" : "text-ink-2 hover:text-ink")}>Retry</button>
    </p>
  );
}
