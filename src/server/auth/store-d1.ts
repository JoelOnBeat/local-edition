import type { D1Like } from "../platform/types";
import { EmailTakenError, type AuthStore, type CounterState, type OnboardingDoc, type SessionRow, type UserRow } from "./store";

interface UserDb { id: string; email: string; name: string; password_hash: string; workspace_id: string; created_at: string }
interface SessionDb { id: string; user_id: string; created_at: number; last_seen_at: number; expires_at: number }

const toUser = (r: UserDb): UserRow => ({ id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, workspaceId: r.workspace_id, createdAt: r.created_at });
const toSession = (r: SessionDb): SessionRow => ({ id: r.id, userId: r.user_id, createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at });

/** D1 driver (migrations/0005_auth.sql). Every query is parameterised; the counters are single atomic upserts. */
export class D1AuthStore implements AuthStore {
  constructor(private readonly db: D1Like) {}

  private q(text: string, ...bind: unknown[]) {
    return this.db.prepare(text).bind(...bind);
  }

  async createUser(u: UserRow): Promise<void> {
    try {
      await this.q("INSERT INTO users (id, email, name, password_hash, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", u.id, u.email, u.name, u.passwordHash, u.workspaceId, u.createdAt).run();
    } catch (e) {
      if (/UNIQUE|constraint/i.test(String((e as Error)?.message))) throw new EmailTakenError();
      throw e;
    }
  }
  async getUserByEmail(email: string) {
    const r = await this.q("SELECT * FROM users WHERE email = ?", email).first<UserDb>();
    return r ? toUser(r) : null;
  }
  async getUserById(id: string) {
    const r = await this.q("SELECT * FROM users WHERE id = ?", id).first<UserDb>();
    return r ? toUser(r) : null;
  }
  async setPasswordHash(userId: string, passwordHash: string) {
    await this.q("UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, userId).run();
  }
  async deleteUser(userId: string) {
    await this.db.batch([
      this.q("DELETE FROM onboarding WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = ?)", userId),
      this.q("DELETE FROM sessions WHERE user_id = ?", userId),
      this.q("DELETE FROM users WHERE id = ?", userId),
    ]);
  }

  async createSession(s: SessionRow) {
    await this.q("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)", s.id, s.userId, s.createdAt, s.lastSeenAt, s.expiresAt).run();
  }
  async findSession(idHash: string) {
    const r = await this.q(
      `SELECT s.id AS s_id, s.user_id, s.created_at AS s_created, s.last_seen_at, s.expires_at,
              u.id AS u_id, u.email, u.name, u.password_hash, u.workspace_id, u.created_at AS u_created
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, idHash,
    ).first<Record<string, string | number>>();
    if (!r) return null;
    return {
      session: toSession({ id: r.s_id as string, user_id: r.user_id as string, created_at: r.s_created as number, last_seen_at: r.last_seen_at as number, expires_at: r.expires_at as number }),
      user: toUser({ id: r.u_id as string, email: r.email as string, name: r.name as string, password_hash: r.password_hash as string, workspace_id: r.workspace_id as string, created_at: r.u_created as string }),
    };
  }
  async touchSession(idHash: string, lastSeenAt: number, expiresAt: number) {
    await this.q("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", lastSeenAt, expiresAt, idHash).run();
  }
  async deleteSession(idHash: string) {
    await this.q("DELETE FROM sessions WHERE id = ?", idHash).run();
  }
  async trimSessions(userId: string, keep: number, protect: string) {
    await this.q(
      "DELETE FROM sessions WHERE user_id = ? AND id <> ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)",
      userId, protect, userId, keep,
    ).run();
  }
  async deleteExpiredSessions(now: number) {
    await this.q("DELETE FROM sessions WHERE expires_at <= ?", now).run();
  }

  async getOnboarding(workspaceId: string) {
    const r = await this.q("SELECT json FROM onboarding WHERE workspace_id = ?", workspaceId).first<{ json: string }>();
    return r ? (JSON.parse(r.json) as OnboardingDoc) : null;
  }
  async putOnboarding(workspaceId: string, doc: OnboardingDoc) {
    await this.q(
      "INSERT INTO onboarding (workspace_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT (workspace_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
      workspaceId, JSON.stringify(doc), doc.updatedAt,
    ).run();
  }
  async deleteOnboarding(workspaceId: string) {
    await this.q("DELETE FROM onboarding WHERE workspace_id = ?", workspaceId).run();
  }

  async hit(key: string, windowMs: number, now: number): Promise<CounterState> {
    const r = await this.q(
      `INSERT INTO auth_counters (key, count, at) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN auth_counters.at <= ? THEN 1 ELSE auth_counters.count + 1 END,
         at = CASE WHEN auth_counters.at <= ? THEN ? ELSE auth_counters.at END
       RETURNING count, at`,
      key, now, now - windowMs, now - windowMs, now,
    ).first<CounterState>();
    return r ?? { count: 1, at: now };
  }
  async fail(key: string, resetMs: number, now: number): Promise<CounterState> {
    const r = await this.q(
      `INSERT INTO auth_counters (key, count, at) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN auth_counters.at <= ? THEN 1 ELSE auth_counters.count + 1 END,
         at = ?
       RETURNING count, at`,
      key, now, now - resetMs, now,
    ).first<CounterState>();
    return r ?? { count: 1, at: now };
  }
  async peek(key: string) {
    return this.q("SELECT count, at FROM auth_counters WHERE key = ?", key).first<CounterState>();
  }
  async clear(key: string) {
    await this.q("DELETE FROM auth_counters WHERE key = ?", key).run();
  }
  async deleteExpiredCounters(before: number) {
    await this.q("DELETE FROM auth_counters WHERE at < ?", before).run();
  }
}
