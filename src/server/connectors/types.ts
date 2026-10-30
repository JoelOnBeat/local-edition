import type { Connection, ConnectorProvider, Delivery, SyncEvent } from "@/contract";

/**
 * Persistence for the connectors (Square, Slack, mail, calendar). One ledger interface, two drivers: D1 in production
 * and an in-memory one for tests and `next dev` without a binding. Secrets are held as ciphertext (see crypto.ts).
 */

export interface StoredConnection {
  connection: Connection;
  /** Provider-side account id (Square merchant id). Webhooks arrive with this, not with a workspace. */
  merchantId: string | null;
  /** Ciphertext. Null for the sample chain, which uses the server-held sandbox token. */
  tokenEnc: string | null;
  refreshEnc: string | null;
  tokenExpiresAt: string | null;
  /** Non-secret provider state: last webhook time, the catalog's own updated_at. */
  meta: Record<string, string | null>;
}

export interface LocationLink {
  locationId: string;
  name: string;
  storeId: string | null;
}

export interface CalendarTokenRow {
  token: string;
  workspaceId: string;
  scope: "store" | "chain";
  storeId: string | null;
}

export interface ConnectorLedger {
  /** Account deletion: every connection (with its sealed tokens), sync event, delivery, location link, OAuth state and calendar token of the workspace. */
  deleteWorkspaceData(workspaceId: string): Promise<void>;
  getConnection(workspaceId: string, provider: ConnectorProvider): Promise<StoredConnection | null>;
  putConnection(workspaceId: string, provider: ConnectorProvider, stored: StoredConnection): Promise<void>;
  deleteConnection(workspaceId: string, provider: ConnectorProvider): Promise<void>;
  /** Every workspace connected to this provider account, newest first (a webhook fans out to them). */
  findByMerchant(provider: ConnectorProvider, merchantId: string, limit: number): Promise<{ workspaceId: string; stored: StoredConnection }[]>;

  addEvent(workspaceId: string, event: SyncEvent): Promise<void>;
  listEvents(workspaceId: string, provider: ConnectorProvider | null, limit: number): Promise<SyncEvent[]>;

  putDelivery(workspaceId: string, delivery: Delivery): Promise<void>;
  getDelivery(workspaceId: string, provider: ConnectorProvider, editionId: string, itemId: string | null): Promise<Delivery | null>;
  listDeliveries(workspaceId: string, editionId: string): Promise<Delivery[]>;

  replaceLocationLinks(workspaceId: string, links: LocationLink[]): Promise<void>;
  listLocationLinks(workspaceId: string): Promise<LocationLink[]>;

  /** Stores a one-use OAuth state for ten minutes. */
  putOAuthState(state: string, workspaceId: string, provider: ConnectorProvider, ttlSeconds: number): Promise<void>;
  /** Returns the workspace the state was issued to and deletes it (single use); null when unknown or expired. */
  consumeOAuthState(state: string, provider: ConnectorProvider): Promise<string | null>;

  getOrCreateCalendarToken(workspaceId: string, scope: "store" | "chain", storeId: string | null, mint: () => string): Promise<string>;
  resolveCalendarToken(token: string): Promise<CalendarTokenRow | null>;
}
