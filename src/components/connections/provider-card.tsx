"use client";

import { useState, type ReactNode } from "react";
import type { Connection, ConnectorProvider } from "@/contract";
import { Button, Chip, Notice, providerName } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { PROVIDER_NAME } from "@/components/app-ui/tiles";
import { formatDateTime } from "@/components/lib/format";
import { relativeTime } from "./time";
import { ToolTile } from "./tool-tile";

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
  /** The tiny picture of the tool in the tile's well. */
  preview?: ReactNode;
  /** The provider's one-click action when connected ("Sync now", "Post digest"). */
  actionLabel?: string;
  onAction?: () => Promise<string>;
  onConnect?: (method?: "sandbox" | "oauth") => Promise<void>;
  onDisconnect?: () => Promise<void>;
  /** Square only: a real account can connect alongside the sample sandbox. */
  oauthAvailable?: boolean;
  sandboxAvailable?: boolean;
}

export function ProviderCard({ connection: c, details, preview, actionLabel, onAction, onConnect, onDisconnect, oauthAvailable, sandboxAvailable = true }: ProviderCardProps) {
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
    <ToolTile
      provider={c.provider}
      testId={`conn-card-${c.provider}`}
      dataStatus={c.status}
      preview={preview}
      status={<Chip data-testid={`conn-status-${c.provider}`} data-status={c.status} tone={s.tone} dot={c.status !== "not_connected"}>{s.label}</Chip>}
    >
      <div className="grid gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-ink">{PROVIDER_NAME[c.provider]}</h3>
          {c.mode ? <Chip data-testid={`conn-mode-${c.provider}`} tone={c.mode === "sandbox" ? "neutral" : "accent"}>{c.mode === "sandbox" ? "Sandbox" : "Production"}</Chip> : null}
        </div>
        {c.accountLabel ? (
          <p data-testid={`conn-account-${c.provider}`} className="break-words font-mono text-[12px] leading-5 text-ink-2">{c.accountLabel}</p>
        ) : null}
        <p className="text-[14px] leading-5 text-ink-2">{BLURB[c.provider] ?? "Not connected yet."}</p>
      </div>

      {c.status === "error" && c.error ? <div data-testid={`conn-error-${c.provider}`}><Notice tone="flag">{c.error}</Notice></div> : null}

      {c.capabilities.length ? (
        <ul className="grid gap-1 text-[13px] leading-5 text-ink-2">
          {c.capabilities.map((cap) => (
            <li key={cap} className="flex gap-2">
              <Icon name={connected ? "check" : "dot"} size={14} strokeWidth={connected ? 2.4 : 3} className={connected ? "mt-[3px] shrink-0 text-ok-ink" : "mt-[3px] shrink-0 text-faint"} />
              <span className="min-w-0">{cap}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {details}

      <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-rule-subtle pt-3 text-[13px] leading-5">
        <div className="min-w-0">
          <dt className="text-muted">Last sync</dt>
          <dd data-testid={`conn-last-sync-${c.provider}`} data-at={c.lastSyncAt ?? ""} className="truncate font-medium text-ink-strong tnum" title={c.lastSyncAt ? formatDateTime(c.lastSyncAt) : undefined}>
            {c.lastSyncAt ? relativeTime(c.lastSyncAt) : "Never"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Connected</dt>
          <dd className="truncate font-medium text-ink-strong tnum">{c.connectedAt ? formatDateTime(c.connectedAt) : "Not yet"}</dd>
        </div>
      </dl>

      {message ? <div data-testid={`conn-message-${c.provider}`} data-tone={message.tone}><Notice tone={message.tone}>{message.text}</Notice></div> : null}

      {confirming ? (
        <div className="grid gap-2.5 rounded-xl bg-flag-bg/60 p-3 text-[13px] leading-5 shadow-[inset_0_0_0_1px_rgb(251_44_54/.18)]">
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
        <div className="flex flex-wrap items-center gap-2">
          {connected || c.status === "error" ? (
            <>
              {connected && onAction && actionLabel ? (
                <Button data-testid={`conn-action-${c.provider}`} size="sm" variant="primary" loading={busy === "action"} onClick={() => run("action", onAction)}>{actionLabel}</Button>
              ) : null}
              {c.status === "error" && onConnect ? (
                <Button data-testid={`conn-reconnect-${c.provider}`} size="sm" variant="primary" loading={busy === "connect"} onClick={() => run("connect", () => onConnect("sandbox"))}>Reconnect</Button>
              ) : null}
              {onDisconnect ? <Button data-testid={`conn-disconnect-${c.provider}`} size="sm" variant="ghost" className="ml-auto text-muted hover:text-flag" onClick={() => setConfirming(true)}>Disconnect</Button> : null}
            </>
          ) : onConnect ? (
            <>
              {sandboxAvailable ? (
                <Button data-testid={`conn-connect-${c.provider}`} size="sm" variant="primary" loading={busy === "connect"} disabled={c.status === "connecting"} onClick={() => run("connect", () => onConnect("sandbox"))}>
                  {c.provider === "square" ? "Connect the sample sandbox" : `Connect ${providerName(c.provider)}`}
                </Button>
              ) : null}
              {oauthAvailable ? (
                <Button data-testid={`conn-connect-oauth-${c.provider}`} size="sm" variant="secondary" loading={busy === "oauth"} onClick={() => run("oauth", () => onConnect("oauth"))}>Connect your own Square</Button>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </ToolTile>
  );
}
