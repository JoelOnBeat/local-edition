"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { Connection, ConnectorProvider, SyncEvent } from "@/contract";
import type { Provider } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { CardBand, ErrorState, Notice, Pill, Skeleton, SkeletonText, providerName } from "@/components/ui";
import { Band, Gap, Page, PageHeader } from "@/components/app-ui/frame";
import { Icon } from "@/components/app-ui/icons";
import { SkeletonRows } from "@/components/app-ui/states";
import { LogoTile, PROVIDER_NAME } from "@/components/app-ui/tiles";
import { useAsync } from "@/components/lib/use-async";
import { MAIL_POLL_LABEL, useMailPoll } from "@/components/lib/use-mail-poll";
import { CalendarCard } from "./calendar-card";
import { connect, disconnect, loadConnections, runAction } from "./connections-api";
import { ProviderCard } from "./provider-card";
import { SyncLog } from "./sync-log";
import { relativeTime } from "./time";
import { MailPreview, SlackPreview, SquarePreview } from "./tool-tile";

const POLL_MS = 15_000;
const ACTION: Partial<Record<ConnectorProvider, string>> = { square: "Sync now", slack: "Post this week's digest", gmail: "Check for replies", outlook: "Check for replies" };

/** Read-only tools that do work in every edition: no account for the chain to connect. */
const POWERED: { p: Provider; role: string }[] = [
  { p: "qloo", role: "Taste of each block" },
  { p: "nemotron", role: "Plans, writes and reviews" },
  { p: "tokenfactory", role: "Runs every model" },
  { p: "tavily", role: "Local event listings" },
];

function CallbackNotice() {
  const q = useSearchParams();
  const square = q.get("square");
  const connected = q.get("connected");
  const reason = q.get("reason");
  if (square === "connected" || connected) {
    const name = connected === "slack" || connected === "gmail" || connected === "outlook" ? providerName(connected) : "Square";
    return <div data-testid="conn-callback" data-ok="true"><Notice tone="ok">{name} is connected. Its first sync is in the log below.</Notice></div>;
  }
  if (square === "error" || q.get("error")) {
    return <div data-testid="conn-callback" data-ok="false"><Notice tone="flag">The connection did not finish{reason ? ` (${reason.replace(/_/g, " ")})` : ""}. Nothing was changed; you can try again.</Notice></div>;
  }
  return null;
}

function TileSkeleton() {
  return (
    <div className="ring-after relative rounded-[14px] bg-white p-1.5" aria-hidden>
      <Skeleton className="h-[132px] rounded-lg" />
      <div className="grid gap-3 px-2.5 pb-2.5 pt-3.5">
        <Skeleton className="h-3 w-28 rounded-full" />
        <SkeletonText lines={3} />
        <Skeleton className="h-8 w-28" />
      </div>
    </div>
  );
}

function FailedTile({ providers, message, onRetry }: { providers: ConnectorProvider[]; message: string; onRetry: () => void }) {
  return (
    <div className="ring-after relative rounded-[14px] bg-white p-1.5" data-testid={`conn-failed-${providers.join("-")}`}>
      <div className="flex h-[64px] items-center gap-2 rounded-lg bg-well px-3 shadow-[inset_0_0_0_1px_var(--well-ring)]">
        {providers.map((p) => <LogoTile key={p} provider={p} size="md" />)}
        <span className="ml-1 truncate text-[14px] font-medium text-ink">{providers.map((p) => PROVIDER_NAME[p]).join(", ")}</span>
      </div>
      <ErrorState title="Status did not load" message={message} onRetry={onRetry} className="py-8" />
    </div>
  );
}

export function ConnectionsView() {
  const { bundle } = useWorkspace();
  const q = useAsync("connections", loadConnections);
  const { reload } = q;

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  const snap = q.data;
  const stores = bundle?.stores ?? [];
  const after = async <T,>(p: Promise<T>) => { const r = await p; reload(); return r; };
  const go = async (provider: ConnectorProvider, method?: "sandbox" | "oauth") => {
    const url = await connect(provider, method);
    if (url) window.location.assign(url);
    else reload();
  };

  // GET /api/connections merges every lane's events newest first; if it failed, fall back to what the lanes returned.
  const events: SyncEvent[] = snap?.merged.ok
    ? snap.merged.data.events
    : [...(snap?.square.ok ? snap.square.data.events : []), ...(snap?.comms.ok ? snap.comms.data.events : [])];
  const mailConnected = Boolean(snap?.merged.ok
    ? snap.merged.data.connections.some((c) => (c.provider === "gmail" || c.provider === "outlook") && c.status === "connected")
    : snap?.comms.ok && snap.comms.data.connections.some((c) => (c.provider === "gmail" || c.provider === "outlook") && c.status === "connected"));
  useMailPoll(mailConnected, reload);
  const channels = snap?.comms.ok ? snap.comms.data.targets.map((t) => t.slackChannel).filter((x): x is string => !!x) : [];
  const card = (c: Connection, details?: React.ReactNode, preview?: React.ReactNode, extra?: { oauthAvailable?: boolean; sandboxAvailable?: boolean }) => (
    <ProviderCard
      key={c.provider}
      connection={c}
      details={details}
      preview={preview}
      actionLabel={ACTION[c.provider]}
      onAction={() => after(runAction(c.provider))}
      onConnect={(m) => go(c.provider, m)}
      onDisconnect={() => after(disconnect(c.provider))}
      {...extra}
    />
  );
  const sq = snap?.square.ok ? snap.square.data : null;
  const sqConnected = sq?.connection.status === "connected";

  return (
    <Page>
      <PageHeader
        pill={<Pill icon={<Icon name="plug" />}>Connections</Pill>}
        title="Connections"
        lede={
          <>
            The tools your stores already use. The menu comes in from Square; approved specials, staff cards and event nights go out to
            Square, Slack, email and the calendar.{bundle?.chain.isSample && snap?.merged.ok && snap.merged.data.connections.some((c) => c.mode === "sandbox") ? " The sample chain uses test accounts, labelled Sandbox." : ""}
          </>
        }
      />
      <Gap />

      <Band>
        <div className="grid gap-3">
          <CallbackNotice />
          {q.error && !snap ? <div data-testid="conn-error"><CardBand title="Connections" flush><ErrorState message={q.error.message} onRetry={reload} /></CardBand></div> : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {!snap ? (
              q.error ? null : [0, 1, 2, 3, 4].map((i) => <TileSkeleton key={i} />)
            ) : (
              <>
                {sq
                  ? card(
                    sq.connection,
                    undefined,
                    <SquarePreview
                      items={sqConnected ? sq.menuItemCount : undefined}
                      linked={sqConnected ? sq.locations.filter((l) => l.storeId).length : undefined}
                      total={sqConnected ? sq.locations.length : undefined}
                      at={sq.lastWebhookAt ? relativeTime(sq.lastWebhookAt) : null}
                    />,
                    { oauthAvailable: sq.oauthAvailable, sandboxAvailable: sq.sandboxAvailable },
                  )
                  : <FailedTile providers={["square"]} message={snap.square.ok ? "" : snap.square.error} onRetry={reload} />}
                {snap.comms.ok
                  ? snap.comms.data.connections.map((c) => card(
                    c,
                    c.provider === "slack" && c.status === "connected" && channels.length ? <Channels names={channels} /> : undefined,
                    c.provider === "slack" ? <SlackPreview channel={channels.find((n) => /head/i.test(n))} /> : <MailPreview />,
                  ))
                  : <FailedTile providers={["slack", "gmail", "outlook"]} message={snap.comms.error} onRetry={reload} />}
                {snap.calendar.ok ? <CalendarCard feeds={snap.calendar.data} /> : <FailedTile providers={["calendar"]} message={snap.calendar.error} onRetry={reload} />}
              </>
            )}
          </div>

          {mailConnected ? (
            <p data-testid="mail-poll-label" className="flex items-center gap-2 px-1 text-[13px] text-muted">
              <span className="le-live-dot size-1.5 rounded-full bg-ok" aria-hidden />{MAIL_POLL_LABEL}
            </p>
          ) : null}
        </div>
      </Band>
      <Gap />

      <Band grow>
        <div className="grid gap-3">
          <PoweredBy />
          {snap ? <SyncLog events={events} stores={stores} live={!q.error} /> : <CardBand title="Sync log" icon={<Icon name="refresh" />} flush><SkeletonRows rows={6} cols={2} /></CardBand>}
        </div>
      </Band>
    </Page>
  );
}

/** The built-on strip: tools that work in every edition without a chain account. */
function PoweredBy() {
  return (
    <section aria-label="Also at work" className="grid overflow-hidden rounded-xl bg-white shadow-ring-xs sm:grid-cols-2 lg:grid-cols-4">
      {POWERED.map(({ p, role }) => (
        <div key={p} className="flex min-w-0 items-center gap-3 border-rule-subtle px-4 py-4 max-lg:[&:nth-child(-n+2)]:border-b max-sm:border-b sm:[&:nth-child(odd)]:border-r lg:border-r lg:last:border-r-0">
          <LogoTile provider={p} size="md" />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium leading-5 text-ink">{PROVIDER_NAME[p]}</span>
            <span className="block truncate text-[13px] leading-5 text-ink-2">{role}</span>
          </span>
          <span className="ml-auto shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">Built in</span>
        </div>
      ))}
    </section>
  );
}

function Channels({ names }: { names: string[] }) {
  return (
    <p className="flex flex-wrap gap-1.5">
      {names.map((n) => (
        <span key={n} className="inline-flex h-6 items-center rounded-md border border-rule bg-white px-2 font-mono text-[12px] text-ink-2">#{n}</span>
      ))}
    </p>
  );
}
