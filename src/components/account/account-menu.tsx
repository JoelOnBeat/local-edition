"use client";

import Link from "next/link";
import { Button, ButtonLink, cx } from "@/components/ui";
import { Dropdown, MenuDivider, MenuItem } from "@/components/app-ui/menu";
import { Icon } from "@/components/app-ui/icons";
import { AccountDelete } from "./account-delete";
import { ErrorLine } from "./plain";
import { useAccountActions } from "./use-account-actions";
import { useMe } from "./use-me";

const initials = (name: string, email: string) =>
  (name.trim() ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]) : [email[0]]).join("").toUpperCase();

/**
 * The account control. `menu` (app header): a 28px avatar that opens a dropdown, or Sign in + "Keep this chain" for a
 * guest. `inline` (onboarding): who is signed in, Sign out and, below the steps, Delete account.
 */
export function AccountMenu({ variant = "menu" }: { variant?: "menu" | "inline" }) {
  const { me, loading } = useMe();
  const actions = useAccountActions();

  if (loading) return <span className="size-7 rounded-lg bg-stone-200/70" aria-hidden />;
  if (!me?.user) {
    return (
      <nav data-testid="account-menu" data-state="signed-out" className="flex items-center gap-1.5">
        {me?.session === "guest" ? null : (
          <Link data-testid="account-signin" href="/signin" className="hidden h-8 items-center whitespace-nowrap rounded-md px-2.5 text-[14px] font-medium text-ink-2 transition-colors duration-150 hover:bg-hover-tint hover:text-ink sm:inline-flex">
            Sign in
          </Link>
        )}
        <ButtonLink data-testid="account-signup" href="/signup" variant="primary" size="sm" chevron>
          {me?.session === "guest" ? <><span className="sm:hidden">Keep it</span><span className="hidden sm:inline">Keep this chain</span></> : "Create account"}
        </ButtonLink>
      </nav>
    );
  }
  const user = me.user;

  if (variant === "inline") {
    return (
      <div data-testid="account-menu" data-state="signed-in" className="flex min-w-0 items-center gap-2 text-[14px] text-ink-2">
        <span className="hidden truncate sm:inline">Signed in as</span>
        <span data-testid="account-email" className="min-w-0 truncate font-medium text-ink-strong">{user.email}</span>
        <Button data-testid="account-signout" size="sm" variant="ghost" loading={actions.busy === "signout"} disabled={actions.busy !== null} onClick={() => void actions.signOut()}>
          Sign out
        </Button>
        <ErrorLine error={actions.error} testId="account-error" />
      </div>
    );
  }

  return (
    <div data-testid="account-menu" data-state="signed-in" className="flex items-center">
      <span data-testid="account-email" className="sr-only">{user.email}</span>
      <Dropdown
        label="Account"
        align="end"
        width="w-72"
        triggerClassName="flex size-8 items-center justify-center rounded-lg transition-[background-color,scale] duration-150 hover:bg-hover-tint active:scale-[.96]"
        trigger={() => (
          <span className="flex size-7 items-center justify-center rounded-lg bg-stone-800 text-[11px] font-semibold tracking-[-0.02em] text-stone-50 shadow-[inset_0_1px_0_rgb(255_255_255/.14)]">
            {initials(user.name, user.email)}
          </span>
        )}
      >
        {(close) => (
          <>
            <div className="flex items-center gap-3 px-2.5 py-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-stone-800 text-[13px] font-semibold text-stone-50">{initials(user.name, user.email)}</span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-ink">{user.name || "Your account"}</span>
                <span className="block truncate text-[13px] text-ink-2">{user.email}</span>
              </span>
            </div>
            <MenuDivider />
            <MenuItem href="/app/settings" onClick={close}><Icon name="settings" className="text-faint" />Settings</MenuItem>
            <MenuItem href="/onboarding" onClick={close}><Icon name="list" className="text-faint" />Setup checklist</MenuItem>
            <MenuItem href="/limits" onClick={close}><Icon name="gauge" className="text-faint" />Limits and spend</MenuItem>
            <MenuDivider />
            <MenuItem testId="account-signout" onClick={() => void actions.signOut()}>
              <Icon name="logout" className="text-faint" />
              {actions.busy === "signout" ? "Signing out…" : "Sign out"}
            </MenuItem>
            {actions.error ? <div className="px-2.5 pb-1.5"><ErrorLine error={actions.error} testId="account-error" /></div> : null}
          </>
        )}
      </Dropdown>
    </div>
  );
}

/** Settings and onboarding: the account's delete control on its own. */
export function AccountDangerZone({ quiet, className }: { quiet?: boolean; className?: string }) {
  const { me } = useMe();
  if (!me?.user) return null;
  return <div className={cx("min-w-0", className)}><AccountDelete user={me.user} quiet={quiet} /></div>;
}
