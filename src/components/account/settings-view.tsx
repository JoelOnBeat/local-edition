"use client";

import type { ReactNode } from "react";
import { Button, ButtonLink, CardBand, ErrorState, Pill, SampleBadge, Skeleton, StoreTile } from "@/components/ui";
import { Band, FrameCard, Gap, Page, PageHeader } from "@/components/app-ui/frame";
import { Icon } from "@/components/app-ui/icons";
import { ScorePill } from "@/components/app-ui/status";
import { StoreStack } from "@/components/app-ui/tiles";
import { useWorkspace } from "@/components/app/workspace-context";
import { shortChainName } from "@/components/app/shell-controls";
import { AccountDangerZone } from "./account-menu";
import { ErrorLine } from "./plain";
import { useAccountActions } from "./use-account-actions";
import { useMe } from "./use-me";

/** /app/settings: the chain as head office set it up, the account, and where spend and proof live. */
export function SettingsView() {
  const { bundle, loading, error, reload } = useWorkspace();
  const { me } = useMe();
  const actions = useAccountActions();

  if (error && !bundle) return <Page><Band grow><CardBand title="Settings" flush><ErrorState message={error.message} onRetry={reload} /></CardBand></Band></Page>;

  const chain = bundle?.chain;
  const name = chain ? shortChainName(chain.name) : "";

  return (
    <Page>
      <PageHeader
        pill={<Pill icon={<Icon name="settings" />}>Settings</Pill>}
        title="Chain settings"
        lede="Your chain as head office set it up, your account, and where the spend and the proof live."
      />
      <Gap />
      <Band pad="frame" grow>
        <FrameCard className="flex-1">
          <article className="divide-y divide-rule-subtle px-5 sm:px-6 md:px-8">
            <Row title="Chain" sub="Every edition is written for this chain, in its voice.">
              {loading || !chain || !bundle ? (
                <div className="grid gap-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-3 w-72 rounded-full" /></div>
              ) : (
                <div className="grid gap-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-[10px] bg-stone-900 text-[15px] font-semibold text-stone-50">{name.slice(0, 1)}</span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[19px] font-medium leading-7 tracking-[-0.02em] text-ink">{name}{chain.isSample ? <SampleBadge /> : null}</p>
                      <p className="text-[14px] text-ink-2 capitalize">{chain.category} · {chain.city.name}</p>
                    </div>
                  </div>
                  <Facts>
                    <Fact label="Stores">
                      {bundle.stores.length ? (
                        <span className="flex flex-wrap items-center gap-2"><StoreStack stores={bundle.stores} max={5} size="md" /><span className="tnum">{bundle.stores.length}</span></span>
                      ) : <span className="text-muted">None yet</span>}
                    </Fact>
                    <Fact label="Menu items"><span className="tnum">{bundle.menu.length}</span></Fact>
                    <Fact label="Brand voice">
                      {chain.brandVoice.length ? (
                        <ul className="grid gap-1.5">{chain.brandVoice.map((l) => <li key={l} className="text-ink-body">“{l}”</li>)}</ul>
                      ) : <span className="text-muted">Not set: editions are written with no voice guidance.</span>}
                    </Fact>
                    <Fact label="Taste anchors">
                      {chain.anchors.length ? (
                        <span className="flex flex-wrap gap-1.5">{chain.anchors.map((a) => <ScorePill key={a.entityId}>{a.name}</ScorePill>)}</span>
                      ) : <span className="text-muted">None yet: a build needs at least one.</span>}
                    </Fact>
                  </Facts>
                  <div className="flex flex-wrap gap-2">
                    <ButtonLink href="/app/setup" size="sm" variant="secondary" icon={<Icon name="pencil" size={14} />}>Edit menu, voice and anchors</ButtonLink>
                    {me?.user ? <ButtonLink href="/onboarding" size="sm" variant="ghost">Setup checklist</ButtonLink> : null}
                  </div>
                </div>
              )}
            </Row>

            <Row title="Stores" sub="Each store keeps one colour: its tile, its map pin and its line in a comparison.">
              {bundle?.stores.length ? (
                <ul className="grid gap-x-6 sm:grid-cols-2">
                  {bundle.stores.map((s) => (
                    <li key={s.id} className="flex min-w-0 items-center gap-3 border-b border-rule-row py-2.5">
                      <StoreTile colorIndex={s.colorIndex} name={s.name} size="lg" />
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium text-ink-strong">{s.name}</span>
                        <span className="block truncate text-[13px] text-muted">{s.addressLabel}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : loading ? <Skeleton className="h-24 w-full" /> : <p className="text-[14px] text-muted">No stores yet. Import them in setup.</p>}
            </Row>

            <Row id="account" title="Account" sub={me?.user ? "Signing out keeps your chain; deleting removes it." : "You are trying the sample chain as a guest."}>
              {me?.user ? (
                <div className="grid gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-[10px] bg-stone-800 text-[13px] font-semibold text-stone-50">
                      {(me.user.name || me.user.email).slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[16px] font-medium text-ink">{me.user.name || "Your account"}</span>
                      <span data-testid="settings-email" className="block truncate text-[14px] text-ink-2">{me.user.email}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <Button size="sm" variant="secondary" icon={<Icon name="logout" size={14} />} loading={actions.busy === "signout"} onClick={() => void actions.signOut()}>Sign out</Button>
                    <AccountDangerZone />
                  </div>
                  <ErrorLine error={actions.error} testId="settings-error" />
                </div>
              ) : (
                <div className="grid gap-3">
                  <p className="max-w-[520px] text-[15px] leading-6 text-ink-2">
                    The sample is a private copy for this browser. Create an account to keep it, connect your own tools and build editions for your stores.
                  </p>
                  <div><ButtonLink href="/signup" variant="primary" size="sm" chevron>Keep this chain</ButtonLink></div>
                </div>
              )}
            </Row>

            <Row title="Spend and proof" sub="What a build costs, where it stops, and what ran.">
              <div className="grid gap-2 sm:grid-cols-2">
                <LinkTile href="/limits" icon="gauge" title="Limits and spend" desc="Model budget, Qloo and Tavily caps, rate limits." />
                <LinkTile href="/proof" icon="shield" title="Proof" desc="The model behind each step and the guardrail eval." />
              </div>
            </Row>
          </article>
        </FrameCard>
      </Band>
    </Page>
  );
}

function Row({ title, sub, children, id }: { title: string; sub: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-6 grid gap-4 py-7 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8 md:py-9">
      <div>
        <h2 className="text-[18px] font-medium leading-[26px] text-ink">{title}</h2>
        <p className="mt-1 text-[14px] leading-5 text-ink-2">{sub}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-8 gap-y-4 text-[14px] leading-5 sm:grid-cols-[140px_minmax(0,1fr)]">{children}</dl>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-medium text-ink-2">{label}</dt>
      <dd className="-mt-3 min-w-0 text-ink-strong sm:mt-0">{children}</dd>
    </>
  );
}

function LinkTile({ href, icon, title, desc }: { href: string; icon: "gauge" | "shield"; title: string; desc: string }) {
  return (
    <ButtonLink href={href} variant="secondary" className="!h-auto !justify-start gap-3 !rounded-xl !px-3.5 !py-3 text-left !whitespace-normal">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-well text-ink-2 shadow-[inset_0_0_0_1px_var(--well-ring)]"><Icon name={icon} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-ink-strong">{title}</span>
        <span className="block text-[13px] font-normal leading-5 text-ink-2">{desc}</span>
      </span>
      <Icon name="arrowUpRight" size={14} className="shrink-0 text-faint" />
    </ButtonLink>
  );
}
