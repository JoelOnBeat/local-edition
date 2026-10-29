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
