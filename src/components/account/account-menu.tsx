"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccountActions } from "./use-account-actions";
import { useMe } from "./use-me";
import { ErrorLine } from "./plain";

/** Plain account menu: who is signed in, sign out, delete account (password asked again). Signed out: links to sign in and sign up. */
export function AccountMenu() {
  const { me, loading } = useMe();
  const actions = useAccountActions();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");

  if (loading) return null;
  if (!me?.user) {
    return (
      <nav data-testid="account-menu" data-state="signed-out">
        <Link data-testid="account-signin" href="/signin">Sign in</Link> · <Link data-testid="account-signup" href="/signup">Create account</Link>
      </nav>
    );
  }
  return (
    <div data-testid="account-menu" data-state="signed-in">
      <span data-testid="account-email">{me.user.email}</span>{" "}
      <button data-testid="account-signout" type="button" disabled={actions.busy !== null} onClick={() => void actions.signOut()}>
        Sign out
      </button>{" "}
      {confirming ? (
        <form
          data-testid="account-delete-form"
          style={{ display: "inline" }}
          onSubmit={(e) => {
            e.preventDefault();
            void actions.deleteAccount(password);
          }}
        >
          <input data-testid="account-delete-password" type="password" aria-label="Password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button data-testid="account-delete-confirm" type="submit" disabled={actions.busy !== null || password === ""}>
            Delete my account and data
          </button>
          <button data-testid="account-delete-cancel" type="button" onClick={() => { setConfirming(false); setPassword(""); }}>
            Cancel
          </button>
        </form>
      ) : (
        <button data-testid="account-delete" type="button" onClick={() => setConfirming(true)}>
          Delete account
        </button>
      )}
      <ErrorLine error={actions.error} testId="account-error" />
    </div>
  );
}
