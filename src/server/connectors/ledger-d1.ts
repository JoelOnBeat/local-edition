import { Connection, Delivery, SyncEvent, type ConnectorProvider } from "@/contract";
import type { D1Like } from "../platform/types";
import type { CalendarTokenRow, ConnectorLedger, LocationLink, StoredConnection } from "./types";

interface ConnRow {
  workspace_id: string;
  json: string;
  merchant_id: string | null;
  token_enc: string | null;
  refresh_enc: string | null;
  token_expires_at: string | null;
  meta: string;
}

const toStored = (r: ConnRow): StoredConnection => ({
  connection: Connection.parse(JSON.parse(r.json)),
  merchantId: r.merchant_id,
  tokenEnc: r.token_enc,
  refreshEnc: r.refresh_enc,
  tokenExpiresAt: r.token_expires_at,
  meta: JSON.parse(r.meta) as Record<string, string | null>,
});

/** D1 driver for the connector tables (migrations/0003_square.sql). Every query is parameterised. */
export class D1Ledger implements ConnectorLedger {
  constructor(private readonly db: D1Like) {}

  async getConnection(ws: string, provider: ConnectorProvider) {
    const r = await this.db.prepare("SELECT * FROM connector_connections WHERE workspace_id = ? AND provider = ?").bind(ws, provider).first<ConnRow>();
    return r ? toStored(r) : null;
  }
  async putConnection(ws: string, provider: ConnectorProvider, s: StoredConnection) {
    await this.db
      .prepare(
        `INSERT INTO connector_connections (workspace_id, provider, json, mode, merchant_id, token_enc, refresh_enc, token_expires_at, meta, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, provider) DO UPDATE SET json = excluded.json, mode = excluded.mode, merchant_id = excluded.merchant_id,
           token_enc = excluded.token_enc, refresh_enc = excluded.refresh_enc, token_expires_at = excluded.token_expires_at,
           meta = excluded.meta, updated_at = excluded.updated_at`,
      )
      .bind(ws, provider, JSON.stringify(s.connection), s.connection.mode ?? "sandbox", s.merchantId, s.tokenEnc, s.refreshEnc, s.tokenExpiresAt, JSON.stringify(s.meta), new Date().toISOString())
      .run();
  }
  async deleteConnection(ws: string, provider: ConnectorProvider) {
    await this.db.prepare("DELETE FROM connector_connections WHERE workspace_id = ? AND provider = ?").bind(ws, provider).run();
  }
  async findByMerchant(provider: ConnectorProvider, merchantId: string, limit: number) {
    const rows = await this.db
      .prepare("SELECT * FROM connector_connections WHERE provider = ? AND merchant_id = ? ORDER BY updated_at DESC LIMIT ?")
      .bind(provider, merchantId, limit)
      .all<ConnRow>();
    return (rows.results ?? []).map((r) => ({ workspaceId: r.workspace_id, stored: toStored(r) }));
  }

  async addEvent(ws: string, e: SyncEvent) {
    await this.db
      .prepare("INSERT OR REPLACE INTO connector_events (id, workspace_id, provider, at, json) VALUES (?, ?, ?, ?, ?)")
      .bind(e.id, ws, e.provider, e.at, JSON.stringify(e))
      .run();
  }
  async listEvents(ws: string, provider: ConnectorProvider | null, limit: number) {
    const q = provider
      ? this.db.prepare("SELECT json FROM connector_events WHERE workspace_id = ? AND provider = ? ORDER BY at DESC, rowid DESC LIMIT ?").bind(ws, provider, limit)
      : this.db.prepare("SELECT json FROM connector_events WHERE workspace_id = ? ORDER BY at DESC, rowid DESC LIMIT ?").bind(ws, limit);
    return ((await q.all<{ json: string }>()).results ?? []).map((r) => SyncEvent.parse(JSON.parse(r.json)));
  }

  async putDelivery(ws: string, d: Delivery) {
    await this.db
      .prepare("INSERT OR REPLACE INTO connector_deliveries (workspace_id, provider, edition_id, item_id, at, json) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(ws, d.provider, d.editionId, d.itemId ?? "", d.at, JSON.stringify(d))
      .run();
  }
  async getDelivery(ws: string, provider: ConnectorProvider, editionId: string, itemId: string | null) {
    const r = await this.db
      .prepare("SELECT json FROM connector_deliveries WHERE workspace_id = ? AND provider = ? AND edition_id = ? AND item_id = ?")
      .bind(ws, provider, editionId, itemId ?? "")
      .first<{ json: string }>();
    return r ? Delivery.parse(JSON.parse(r.json)) : null;
  }
  async listDeliveries(ws: string, editionId: string) {
    const rows = await this.db.prepare("SELECT json FROM connector_deliveries WHERE workspace_id = ? AND edition_id = ? ORDER BY at").bind(ws, editionId).all<{ json: string }>();
    return (rows.results ?? []).map((r) => Delivery.parse(JSON.parse(r.json)));
  }

  async replaceLocationLinks(ws: string, links: LocationLink[]) {
    await this.db.batch([
      this.db.prepare("DELETE FROM square_locations WHERE workspace_id = ?").bind(ws),
      ...links.map((l) => this.db.prepare("INSERT INTO square_locations (workspace_id, location_id, name, store_id) VALUES (?, ?, ?, ?)").bind(ws, l.locationId, l.name, l.storeId)),
    ]);
  }
  async listLocationLinks(ws: string) {
    const rows = await this.db.prepare("SELECT location_id, name, store_id FROM square_locations WHERE workspace_id = ? ORDER BY name").bind(ws).all<{ location_id: string; name: string; store_id: string | null }>();
    return (rows.results ?? []).map((r) => ({ locationId: r.location_id, name: r.name, storeId: r.store_id }));
  }

  async putOAuthState(state: string, workspaceId: string, provider: ConnectorProvider, ttlSeconds: number) {
    const now = Date.now();
    await this.db.batch([
      this.db.prepare("DELETE FROM connector_oauth_state WHERE expires_at < ?").bind(now),
      this.db.prepare("INSERT INTO connector_oauth_state (state, workspace_id, provider, expires_at) VALUES (?, ?, ?, ?)").bind(state, workspaceId, provider, now + ttlSeconds * 1000),
    ]);
  }
  async consumeOAuthState(state: string, provider: ConnectorProvider) {
    const row = await this.db
      .prepare("SELECT workspace_id, expires_at FROM connector_oauth_state WHERE state = ? AND provider = ?")
      .bind(state, provider)
      .first<{ workspace_id: string; expires_at: number }>();
    await this.db.prepare("DELETE FROM connector_oauth_state WHERE state = ?").bind(state).run();
    return row && row.expires_at > Date.now() ? row.workspace_id : null;
  }

  async getOrCreateCalendarToken(ws: string, scope: "store" | "chain", storeId: string | null, mint: () => string) {
    const sid = storeId ?? "";
    const find = () => this.db.prepare("SELECT token FROM calendar_tokens WHERE workspace_id = ? AND scope = ? AND store_id = ?").bind(ws, scope, sid).first<{ token: string }>();
    const existing = await find();
    if (existing) return existing.token;
    await this.db
      .prepare("INSERT OR IGNORE INTO calendar_tokens (token, workspace_id, scope, store_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(mint(), ws, scope, sid, new Date().toISOString())
      .run();
    return (await find())!.token; // a concurrent request may have won the insert: read back whichever token is stored
  }
  async resolveCalendarToken(token: string): Promise<CalendarTokenRow | null> {
    const r = await this.db.prepare("SELECT workspace_id, scope, store_id FROM calendar_tokens WHERE token = ?").bind(token).first<{ workspace_id: string; scope: "store" | "chain"; store_id: string }>();
    return r ? { token, workspaceId: r.workspace_id, scope: r.scope, storeId: r.store_id === "" ? null : r.store_id } : null;
  }
}
