"use client";

import { ButtonLink, SampleBadge, cx } from "@/components/ui";
import { Dropdown, MenuDivider, MenuItem, MenuLabel } from "@/components/app-ui/menu";
import { Icon } from "@/components/app-ui/icons";
import { useWorkspace } from "@/components/app/workspace-context";
import { ErrorLine } from "./plain";
import { useAccountActions } from "./use-account-actions";
import { useMe } from "./use-me";

const shortName = (name: string) => name.replace(/\s*\(sample chain\)\s*$/i, "");
const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "·";

/**
 * The one identity block, bottom left of the sidebar: the chain (workspace) and who is using it. Its menu holds the
 * chain settings, the setup checklist, the account and sign out. A guest on the sample chain gets "Keep this chain".
 */
export function IdentityBlock({ onNavigate }: { onNavigate?: () => void }) {
  const { me, loading } = useMe();
  const { bundle } = useWorkspace();
  const actions = useAccountActions();
  const chain = bundle?.chain;
  const name = chain ? shortName(chain.name) : "";
  const user = me?.user ?? null;

  if (loading) return <div className="h-[52px] rounded-xl bg-stone-200/50" aria-hidden />;

  return (
    <div data-testid="account-menu" data-state={user ? "signed-in" : "signed-out"} className="grid gap-2">
      {user ? <span data-testid="account-email" className="sr-only">{user.email}</span> : null}
      <Dropdown
        label="Workspace and account"
        side="top"
        width="w-[248px]"
        testId="identity-trigger"
        triggerClassName="group flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-[background-color,scale] duration-150 hover:bg-hover-tint active:scale-[.99] aria-expanded:bg-active-tint"
        trigger={() => (
          <>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-[12px] font-semibold text-stone-50 shadow-[inset_0_1px_0_rgb(255_255_255/.14)]">
              {name ? name.slice(0, 1) : "·"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-medium leading-5 text-ink-strong">{name || "Your chain"}</span>
                {chain?.isSample ? <SampleBadge className="h-[18px] px-1.5 text-[11px]" /> : null}
              </span>
              <span className="block truncate text-[12px] leading-4 text-ink-2">{user ? user.email : "Guest on the sample chain"}</span>
            </span>
            <Icon name="chevronsUpDown" size={14} className="shrink-0 text-faint group-hover:text-ink-2" />
          </>
        )}
      >
        {(close) => {
          const go = () => { close(); onNavigate?.(); };
          return (
            <>
              <MenuLabel>Workspace</MenuLabel>
              <MenuItem href="/app/settings" onClick={go} testId="nav-settings"><Icon name="settings" className="text-faint" />Chain settings</MenuItem>
              {user ? <MenuItem href="/onboarding" onClick={go}><Icon name="list" className="text-faint" />Setup checklist</MenuItem> : null}
              <MenuItem href="/app/setup" onClick={go}><Icon name="pencil" className="text-faint" />Menu, voice and anchors</MenuItem>
              <MenuDivider />
              <MenuLabel>Account</MenuLabel>
              {user ? (
                <>
                  <div className="flex items-center gap-2.5 px-2.5 py-1.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-[11px] font-semibold text-ink-strong">{initials(user.name || user.email)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{user.name || "Your account"}</span>
                      <span className="block truncate text-[12px] text-ink-2">{user.email}</span>
                    </span>
                  </div>
                  <MenuItem href="/app/settings#account" onClick={go}><Icon name="user" className="text-faint" />Account and data</MenuItem>
                  <MenuItem testId="account-signout" onClick={() => void actions.signOut()}>
                    <Icon name="logout" className="text-faint" />
                    {actions.busy === "signout" ? "Signing out…" : "Sign out"}
                  </MenuItem>
                </>
              ) : (
                <>
                  <MenuItem href="/signup" onClick={go}><Icon name="user" className="text-faint" />Create an account</MenuItem>
                  <MenuItem href="/signin" onClick={go} testId="account-signin"><Icon name="arrowRight" className="text-faint" />Sign in</MenuItem>
                </>
              )}
              <MenuDivider />
              <MenuItem href="/" onClick={go}><Icon name="external" className="text-faint" />Local Edition website</MenuItem>
            </>
          );
        }}
      </Dropdown>
      {!user ? (
        <ButtonLink data-testid="account-signup" href="/signup" variant="primary" size="sm" chevron className={cx("w-full")}>
          Keep this chain
        </ButtonLink>
      ) : null}
      {actions.error ? <ErrorLine error={actions.error} testId="account-error" /> : null}
    </div>
  );
}
