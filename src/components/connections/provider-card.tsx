"use client";

import { useState, type ReactNode } from "react";
import type { Connection, ConnectorProvider } from "@/contract";
import { Button, Card, Chip, Notice, ProviderBadge, providerName } from "@/components/ui";
import { formatDateTime } from "@/components/lib/format";
import { relativeTime } from "./time";

/** One connected tool: status, the account it is, sandbox or production, last sync, what it does, and its actions. */

const STATUS: Record<Connection["status"], { tone: "ok" | "warn" | "flag" | "neutral"; label: string }> = {
  connected: { tone: "ok", label: "Connected" },
  connecting: { tone: "warn", label: "Connecting" },
  error: { tone: "flag", label: "Needs attention" },
  not_connected: { tone: "neutral", label: "Not connected" },
};

const BLURB: Partial<Record<ConnectorProvider, string>> = {
  square: "Your menu and locations come from Square. Approved specials go back as items on each store's menu.",
  slack: "Head office approves from #head-office. Each store's channel gets its staff card.",
  gmail: "Staff cards go out from head office's own mailbox. Store replies come back to the edition.",
  outlook: "The same as Gmail, for chains on Microsoft 365.",
};

export interface ProviderCardProps {
  connection: Connection;
  /** Shown under the capabilities: locations, channels, counts. */
  details?: ReactNode;
  /** The provider's one-click action when connected ("Sync now", "Post digest"). */
  actionLabel?: string;
  onAction?: () => Promise<string>;
  onConnect?: (method?: "sandbox" | "oauth") => Promise<void>;
  onDisconnect?: () => Promise<void>;
  /** Square only: a real account can connect alongside the sample sandbox. */
  oauthAvailable?: boolean;
  sandboxAvailable?: boolean;
}

export function ProviderCard({ connection: c, details, actionLabel, onAction, onConnect, onDisconnect, oauthAvailable, sandboxAvailable = true }: ProviderCardProps) {
  const [busy, setBusy] = useState<"connect" | "oauth" | "disconnect" | "action" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "flag"; text: string } | null>(null);
  const s = STATUS[c.status];
  const connected = c.status === "connected";

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string | void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ tone: "ok", text });
    } catch (e) {
      setMessage({ tone: "flag", text: (e as Error)?.message || "That did not work. Try again." });
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-5" data-testid={`conn-card-${c.provider}`} data-status={c.status}>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ProviderBadge provider={c.provider} className="text-[15px] font-semibold text-ink [&>span:first-child]:h-6 [&>span:first-child]:min-w-6 [&>span:first-child]:text-[11px]" />
          <span className="flex flex-wrap gap-1.5">
            {c.mode ? <Chip data-testid={`conn-mode-${c.provider}`} tone={c.mode === "sandbox" ? "warn" : "info"} mono>{c.mode === "sandbox" ? "Sandbox" : "Production"}</Chip> : null}
            <Chip data-testid={`conn-status-${c.provider}`} data-status={c.status} tone={s.tone} dot>{s.label}</Chip>
          </span>
        </div>
        {c.accountLabel ? (
          <p data-testid={`conn-account-${c.provider}`} className="break-words font-mono text-[12.5px] text-ink-2">{c.accountLabel}</p>
        ) : (
          <p className="text-[13.5px] text-muted">{BLURB[c.provider] ?? "Not connected yet."}</p>
        )}
      </div>

      {c.status === "error" && c.error ? <div data-testid={`conn-error-${c.provider}`}><Notice tone="flag">{c.error}</Notice></div> : null}

      {c.capabilities.length ? (
        <ul className="grid gap-1.5 text-[14px] text-ink-2">
          {c.capabilities.map((cap) => (
            <li key={cap} className="flex gap-2">
              <span aria-hidden className={connected ? "text-ok" : "text-muted"}>{connected ? "✓" : "·"}</span>
              <span>{cap}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {details}

      <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-rule pt-3 text-[12.5px]">
        <div className="min-w-0">
          <dt className="text-muted">Last sync</dt>
          <dd data-testid={`conn-last-sync-${c.provider}`} data-at={c.lastSyncAt ?? ""} className="truncate font-mono text-ink" title={c.lastSyncAt ? formatDateTime(c.lastSyncAt) : undefined}>
            {c.lastSyncAt ? relativeTime(c.lastSyncAt) : "Never"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Connected</dt>
          <dd className="truncate font-mono text-ink">{c.connectedAt ? formatDateTime(c.connectedAt) : "Not yet"}</dd>
        </div>
      </dl>

      {message ? <div data-testid={`conn-message-${c.provider}`} data-tone={message.tone}><Notice tone={message.tone}>{message.text}</Notice></div> : null}

      {confirming ? (
        <div className="grid gap-2 rounded-[var(--radius)] border border-rule bg-paper-2 p-3 text-[13.5px]">
          <p className="text-ink">
            Disconnect {providerName(c.provider)}? Its token is deleted. What already reached {providerName(c.provider)} stays there.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button data-testid={`conn-disconnect-confirm-${c.provider}`} size="sm" variant="danger" loading={busy === "disconnect"} onClick={() => run("disconnect", async () => onDisconnect?.())}>
              Disconnect
            </Button>
            <Button data-testid={`conn-disconnect-cancel-${c.provider}`} size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy === "disconnect"}>Keep it</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {connected || c.status === "error" ? (
            <>
              {connected && onAction && actionLabel ? (
                <Button data-testid={`conn-action-${c.provider}`} size="sm" variant="primary" loading={busy === "action"} onClick={() => run("action", onAction)}>{actionLabel}</Button>
              ) : null}
              {c.status === "error" && onConnect ? (
                <Button data-testid={`conn-reconnect-${c.provider}`} size="sm" variant="primary" loading={busy === "connect"} onClick={() => run("connect", () => onConnect("sandbox"))}>Reconnect</Button>
              ) : null}
              {onDisconnect ? <Button data-testid={`conn-disconnect-${c.provider}`} size="sm" variant="ghost" onClick={() => setConfirming(true)}>Disconnect</Button> : null}
            </>
          ) : onConnect ? (
            <>
              {sandboxAvailable ? (
                <Button data-testid={`conn-connect-${c.provider}`} size="sm" variant="primary" loading={busy === "connect"} disabled={c.status === "connecting"} onClick={() => run("connect", () => onConnect("sandbox"))}>
                  {c.provider === "square" ? "Connect the sample sandbox" : `Connect ${providerName(c.provider)}`}
                </Button>
              ) : null}
              {oauthAvailable ? (
                <Button data-testid={`conn-connect-oauth-${c.provider}`} size="sm" loading={busy === "oauth"} onClick={() => run("oauth", () => onConnect("oauth"))}>Connect your own Square</Button>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}
