"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { Connection, ConnectorProvider, SquareStatus, SyncEvent } from "@/contract";
import { useWorkspace } from "@/components/app/workspace-context";
import { Card, ErrorState, Notice, ProviderBadge, Skeleton, SkeletonText, providerName } from "@/components/ui";
import { useAsync } from "@/components/lib/use-async";
import { MAIL_POLL_LABEL, useMailPoll } from "@/components/lib/use-mail-poll";
import { CalendarCard } from "./calendar-card";
import { connect, disconnect, loadConnections, runAction } from "./connections-api";
import { ProviderCard } from "./provider-card";
import { SyncLog } from "./sync-log";

const POLL_MS = 15_000;
const ACTION: Partial<Record<ConnectorProvider, string>> = { square: "Sync now", slack: "Post this week's digest", gmail: "Check for replies", outlook: "Check for replies" };

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

function CardSkeleton() {
  return (
    <Card className="grid gap-4 p-5" aria-hidden>
      <Skeleton className="h-5 w-32" />
      <SkeletonText lines={3} />
      <Skeleton className="h-8 w-28" />
    </Card>
  );
}

function FailedCard({ providers, message, onRetry }: { providers: ConnectorProvider[]; message: string; onRetry: () => void }) {
  return (
    <Card className="grid gap-3 p-5" data-testid={`conn-failed-${providers.join("-")}`}>
      <div className="flex flex-wrap gap-3">{providers.map((p) => <ProviderBadge key={p} provider={p} className="text-[15px] font-semibold text-ink" />)}</div>
      <ErrorState title="Status did not load" message={message} onRetry={onRetry} className="py-5" />
    </Card>
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
  const card = (c: Connection, details?: React.ReactNode, extra?: { oauthAvailable?: boolean; sandboxAvailable?: boolean }) => (
    <ProviderCard
      key={c.provider}
      connection={c}
      details={details}
      actionLabel={ACTION[c.provider]}
      onAction={() => after(runAction(c.provider))}
      onConnect={(m) => go(c.provider, m)}
      onDisconnect={() => after(disconnect(c.provider))}
      {...extra}
    />
  );

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="font-display text-[clamp(30px,4vw,44px)] font-extrabold leading-none tracking-[-0.02em]">Connections</h1>
        <p className="max-w-[68ch] text-[15.5px] text-ink-2">
          The tools your stores already use. The menu comes in from Square; approved specials, staff cards and event nights go out to
          Square, Slack, email and the calendar. {bundle?.chain.isSample ? "The sample chain is connected to test accounts, labelled Sandbox." : ""}
        </p>
      </header>

      <CallbackNotice />

      {q.error && !snap ? <div data-testid="conn-error"><ErrorState message={q.error.message} onRetry={reload} /></div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!snap ? (
          q.error ? null : [0, 1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)
        ) : (
          <>
            {snap.square.ok
              ? card(snap.square.data.connection, <SquareDetails status={snap.square.data} />, { oauthAvailable: snap.square.data.oauthAvailable, sandboxAvailable: snap.square.data.sandboxAvailable })
              : <FailedCard providers={["square"]} message={snap.square.error} onRetry={reload} />}
            {snap.comms.ok
              ? snap.comms.data.connections.map((c) => card(c, c.provider === "slack" && c.status === "connected" ? <Channels names={snap.comms.ok ? snap.comms.data.targets.map((t) => t.slackChannel).filter((x): x is string => !!x) : []} /> : undefined))
              : <FailedCard providers={["slack", "gmail", "outlook"]} message={snap.comms.error} onRetry={reload} />}
            {snap.calendar.ok ? <CalendarCard feeds={snap.calendar.data} /> : <FailedCard providers={["calendar"]} message={snap.calendar.error} onRetry={reload} />}
          </>
        )}
      </div>

      {mailConnected ? <p data-testid="mail-poll-label" className="text-[12.5px] text-muted">{MAIL_POLL_LABEL}</p> : null}

      {snap ? <SyncLog events={events} stores={stores} live={!q.error} /> : <SkeletonText lines={6} />}
    </div>
  );
}

function SquareDetails({ status }: { status: SquareStatus }) {
  if (status.connection.status !== "connected") return null;
  const linked = status.locations.filter((l) => l.storeId).length;
  return (
    <p className="rounded-[var(--radius)] bg-paper-2 px-3 py-2 font-mono text-[12px] text-ink-2">
      {status.menuItemCount} menu items · {linked} of {status.locations.length} locations linked to stores
      {status.merchantId ? ` · ${status.merchantId}` : ""}
    </p>
  );
}

function Channels({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <p className="rounded-[var(--radius)] bg-paper-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink-2">
      {names.map((n) => `#${n}`).join("  ")}
    </p>
  );
}
