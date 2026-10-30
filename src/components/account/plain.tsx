import type { ReactNode } from "react";
import type { ShownError } from "../lib/use-async";

/** Unstyled building blocks for the test screens. Gabriel's visual track replaces the screens; the hooks stay. */

export function ErrorLine({ error, testId = "error" }: { error: (ShownError & { retryAfterSeconds?: number }) | undefined; testId?: string }) {
  if (!error) return null;
  return (
    <p role="alert" data-testid={testId} data-code={error.code ?? ""} data-retry-after={error.retryAfterSeconds ?? ""}>
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
