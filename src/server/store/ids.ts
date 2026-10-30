/**
 * Per-workspace id remapping. A visitor workspace owns copies of the sample rows; their ids are the
 * canonical sample id plus `~<suffix>` so rows never collide across workspaces, while fixtures keyed by
 * the canonical id still resolve through `canonicalId`.
 */

export const WORKSPACE_ID_SEPARATOR = "~";

export function remapId(id: string, suffix: string): string {
  return `${id}${WORKSPACE_ID_SEPARATOR}${suffix}`;
}

/** `store_williamsburg~k3j9...` -> `store_williamsburg`. Ids without a suffix pass through. */
export function canonicalId(id: string): string {
  const at = id.indexOf(WORKSPACE_ID_SEPARATOR);
  return at === -1 ? id : id.slice(0, at);
}

/** Suffix for a workspace id: `ws_abc123` -> `abc123`; `demo` stays `demo`. */
export function workspaceSuffix(workspaceId: string): string {
  return workspaceId.startsWith("ws_") ? workspaceId.slice(3) : workspaceId;
}

/** Visitor rows expire with their cookie (30 days) plus a day of margin; the demo workspace never expires. */
export const VISITOR_TTL_SECONDS = 31 * 24 * 3600;

/** An account's workspace id (`acct_…`), or a row id remapped into one (`…~acct_…`). Account rows never expire. */
export const ACCOUNT_ID_PREFIX = "acct_";
export function isAccountId(id: string): boolean {
  return id.startsWith(ACCOUNT_ID_PREFIX) || id.includes(`${WORKSPACE_ID_SEPARATOR}${ACCOUNT_ID_PREFIX}`);
}

/** True for ids minted for a visitor workspace (`ws_…`) or remapped into one (`…~suffix`). An account's ids are not visitor ids. */
export function isVisitorId(id: string): boolean {
  if (isAccountId(id)) return false;
  return id.startsWith("ws_") || id.includes(WORKSPACE_ID_SEPARATOR);
}

/** The canonical demo workspace: the sample chain with canonical ids, built by the weekly job. A cookie can never name it. */
export const DEMO_WORKSPACE_ID = "demo";
