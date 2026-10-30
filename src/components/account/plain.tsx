import type { ReactNode } from "react";
import type { ShownError } from "../lib/use-async";

/** Unstyled building blocks for the test screens. Gabriel's visual track replaces the screens; the hooks stay. */

export function ErrorLine({ error, testId = "error" }: { error: (ShownError & { retryAfterSeconds?: number }) | undefined; testId?: string }) {
  if (!error) return null;
  // A model that is down for a while is not the user's mistake: amber and polite, not red.
  const unavailable = error.code === "model_unavailable";
  return (
    <p role={unavailable ? "status" : "alert"} data-testid={testId} data-code={error.code ?? ""} data-tone={unavailable ? "warn" : "flag"} data-retry-after={error.retryAfterSeconds ?? ""} className={`text-[13px] leading-5 ${unavailable ? "text-warn-ink" : "text-flag"} [overflow-wrap:anywhere]`}>
      {error.message}
    </p>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", margin: "8px 0" }}>
      <span style={{ display: "block" }}>{label}</span>
      {children}
    </label>
  );
}
