import type { ConnectorProvider, Delivery, SyncEvent } from "@/contract";
import type { CalendarTokenRow, ConnectorLedger, LocationLink, StoredConnection } from "./types";

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory ledger: tests, and `next dev` without a D1 binding. State is per process. */
export class MemoryLedger implements ConnectorLedger {
  private connections = new Map<string, StoredConnection & { workspaceId: string; provider: ConnectorProvider; seq: number }>();
  private events = new Map<string, { workspaceId: string; event: SyncEvent }[]>();
  private deliveries = new Map<string, Delivery>();
  private links = new Map<string, LocationLink[]>();
  private oauth = new Map<string, { workspaceId: string; provider: ConnectorProvider; exp: number }>();
  private tokens = new Map<string, CalendarTokenRow>();
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async getConnection(ws: string, provider: ConnectorProvider) {
    const row = this.connections.get(`${ws}|${provider}`);
    return row ? clone({ connection: row.connection, merchantId: row.merchantId, tokenEnc: row.tokenEnc, refreshEnc: row.refreshEnc, tokenExpiresAt: row.tokenExpiresAt, meta: row.meta }) : null;
  }
  async putConnection(ws: string, provider: ConnectorProvider, stored: StoredConnection) {
    this.connections.set(`${ws}|${provider}`, { ...clone(stored), workspaceId: ws, provider, seq: ++this.seq });
  }
  async deleteConnection(ws: string, provider: ConnectorProvider) {
    this.connections.delete(`${ws}|${provider}`);
  }
  async findByMerchant(provider: ConnectorProvider, merchantId: string, limit: number) {
    return [...this.connections.values()]
      .filter((r) => r.provider === provider && r.merchantId === merchantId)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit)
      .map((r) => ({ workspaceId: r.workspaceId, stored: clone({ connection: r.connection, merchantId: r.merchantId, tokenEnc: r.tokenEnc, refreshEnc: r.refreshEnc, tokenExpiresAt: r.tokenExpiresAt, meta: r.meta }) }));
  }

  async addEvent(ws: string, event: SyncEvent) {
    const list = this.events.get(ws) ?? [];
    list.push({ workspaceId: ws, event: clone(event) });
    this.events.set(ws, list);
  }
  async listEvents(ws: string, provider: ConnectorProvider | null, limit: number) {
    return (this.events.get(ws) ?? [])
      .map((r, i) => ({ e: r.event, i }))
      .filter(({ e }) => provider === null || e.provider === provider)
      .sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i)
      .map(({ e }) => e)
      .slice(0, limit)
      .map(clone);
  }

  private dkey = (ws: string, provider: ConnectorProvider, editionId: string, itemId: string | null) => `${ws}|${provider}|${editionId}|${itemId ?? ""}`;
  async putDelivery(ws: string, d: Delivery) {
    this.deliveries.set(this.dkey(ws, d.provider, d.editionId, d.itemId), clone(d));
  }
  async getDelivery(ws: string, provider: ConnectorProvider, editionId: string, itemId: string | null) {
    const d = this.deliveries.get(this.dkey(ws, provider, editionId, itemId));
    return d ? clone(d) : null;
  }
  async listDeliveries(ws: string, editionId: string) {
    return [...this.deliveries.entries()].filter(([k, d]) => k.startsWith(`${ws}|`) && d.editionId === editionId).map(([, d]) => clone(d));
  }

  async replaceLocationLinks(ws: string, links: LocationLink[]) {
    this.links.set(ws, clone(links));
  }
  async listLocationLinks(ws: string) {
    return clone(this.links.get(ws) ?? []);
  }

  async putOAuthState(state: string, workspaceId: string, provider: ConnectorProvider, ttlSeconds: number) {
    this.oauth.set(state, { workspaceId, provider, exp: this.now() + ttlSeconds * 1000 });
  }
  async consumeOAuthState(state: string, provider: ConnectorProvider) {
    const row = this.oauth.get(state);
    this.oauth.delete(state);
    return row && row.provider === provider && row.exp > this.now() ? row.workspaceId : null;
  }

  async getOrCreateCalendarToken(ws: string, scope: "store" | "chain", storeId: string | null, mint: () => string) {
    const existing = [...this.tokens.values()].find((t) => t.workspaceId === ws && t.scope === scope && t.storeId === storeId);
    if (existing) return existing.token;
    const token = mint();
    this.tokens.set(token, { token, workspaceId: ws, scope, storeId });
    return token;
  }
  async resolveCalendarToken(token: string) {
    const row = this.tokens.get(token);
    return row ? clone(row) : null;
  }
}
