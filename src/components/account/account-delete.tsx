"use client";

import { useState } from "react";
import type { AuthUser } from "@/contract";
import { Button, Input } from "@/components/ui";
import { ErrorLine } from "./plain";
import { useAccountActions } from "./use-account-actions";

/**
 * Delete the account and its data. The password (or, for a code-only account, the email address) is asked again.
 * Keeps the account-delete* test ids. `quiet` renders the opener as a small ghost link (onboarding footer).
 */
export function AccountDelete({ user, quiet }: { user: AuthUser; quiet?: boolean }) {
  const actions = useAccountActions();
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState("");
  const ask = user.hasPassword ? "Password" : "Type your email address to confirm";

  if (!confirming) {
    return (
      <Button data-testid="account-delete" size="sm" variant={quiet ? "ghost" : "danger"} onClick={() => setConfirming(true)} className={quiet ? "-ml-2.5 text-muted" : undefined}>
        Delete account
      </Button>
    );
  }
  return (
    <form
      data-testid="account-delete-form"
      className="grid w-full max-w-[420px] gap-3 rounded-xl bg-flag-bg/60 p-4 shadow-[inset_0_0_0_1px_rgb(251_44_54/.18)]"
      onSubmit={(e) => {
        e.preventDefault();
        void actions.deleteAccount(user.hasPassword ? value : { confirmEmail: value });
      }}
    >
      <p className="text-[14px] leading-5 text-ink">
        <span className="font-medium">Delete {user.email} and every edition, store and connection in it.</span>{" "}
        <span className="text-ink-2">This cannot be undone.</span>
      </p>
      <label className="grid gap-2">
        <span className="text-[13px] font-medium text-ink-2">{ask}</span>
        <Input
          data-testid="account-delete-password"
          type={user.hasPassword ? "password" : "email"}
          aria-label={ask}
          placeholder={user.hasPassword ? "Your password" : user.email}
          autoComplete={user.hasPassword ? "current-password" : "off"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={actions.error ? true : undefined}
        />
      </label>
      <ErrorLine error={actions.error} testId="account-error" />
      <div className="flex flex-wrap gap-2">
        <Button data-testid="account-delete-confirm" type="submit" size="sm" variant="danger" loading={actions.busy === "delete"} disabled={actions.busy !== null || value === ""}>
          Delete my account and data
        </Button>
        <Button data-testid="account-delete-cancel" size="sm" variant="ghost" onClick={() => { setConfirming(false); setValue(""); }}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
