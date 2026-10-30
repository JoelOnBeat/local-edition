import { serial } from "../serial";
import type { KvLike } from "../store";
import { EmailTakenError, type AuthStore, type CounterState, type OnboardingDoc, type SessionRow, type UserRow } from "./store";

/**
 * Key-value driver for `next dev` (file), tests (memory) and any non-D1 setup. Keys: user:<id> · uemail:<email> -> id ·
 * sess:<hash> · usess:<userId> -> hashes · onb:<workspace> · ctr:<key>. Read-modify-write goes through `serial`, which is exact
 * inside one process; production runs on D1, where the same operations are atomic statements.
 */
export class KvAuthStore implements AuthStore {
  constructor(private readonly kv: KvLike) {}

  private get<T>(key: string): Promise<T | null> {
    return this.kv.get(key) as Promise<T | null>;
  }

  async createUser(u: UserRow) {
    await serial(`auth:email:${u.email}`, async () => {
      if (await this.kv.get(`uemail:${u.email}`)) throw new EmailTakenError();
      await this.kv.put(`user:${u.id}`, u);
      await this.kv.put(`uemail:${u.email}`, u.id);
    });
  }
  async getUserByEmail(email: string) {
    const id = await this.get<string>(`uemail:${email}`);
    return id ? this.getUserById(id) : null;
  }
  getUserById(id: string) {
    return this.get<UserRow>(`user:${id}`);
  }
  async setPasswordHash(userId: string, passwordHash: string) {
    const u = await this.getUserById(userId);
    if (u) await this.kv.put(`user:${userId}`, { ...u, passwordHash });
  }
  async deleteUser(userId: string) {
    const u = await this.getUserById(userId);
    if (!u) return;
    for (const h of (await this.get<string[]>(`usess:${userId}`)) ?? []) await this.kv.delete(`sess:${h}`);
    await this.kv.delete(`usess:${userId}`);
    await this.kv.delete(`onb:${u.workspaceId}`);
    await this.kv.delete(`uemail:${u.email}`);
    await this.kv.delete(`user:${userId}`);
  }

  async createSession(s: SessionRow) {
    await this.kv.put(`sess:${s.id}`, s);
    await serial(`auth:usess:${s.userId}`, async () => {
      const list = (await this.get<string[]>(`usess:${s.userId}`)) ?? [];
      await this.kv.put(`usess:${s.userId}`, [...list.filter((h) => h !== s.id), s.id]);
    });
  }
  async findSession(idHash: string) {
    const session = await this.get<SessionRow>(`sess:${idHash}`);
    if (!session) return null;
    const user = await this.getUserById(session.userId);
    return user ? { session, user } : null;
  }
  async touchSession(idHash: string, lastSeenAt: number, expiresAt: number) {
    const s = await this.get<SessionRow>(`sess:${idHash}`);
    if (s) await this.kv.put(`sess:${idHash}`, { ...s, lastSeenAt, expiresAt });
  }
  async deleteSession(idHash: string) {
    const s = await this.get<SessionRow>(`sess:${idHash}`);
    await this.kv.delete(`sess:${idHash}`);
    if (!s) return;
    await serial(`auth:usess:${s.userId}`, async () => {
      const list = (await this.get<string[]>(`usess:${s.userId}`)) ?? [];
      await this.kv.put(`usess:${s.userId}`, list.filter((h) => h !== idHash));
    });
  }
  async trimSessions(userId: string, keep: number, protect: string) {
    const hashes = (await this.get<string[]>(`usess:${userId}`)) ?? [];
    const rows = (await Promise.all(hashes.map((h) => this.get<SessionRow>(`sess:${h}`)))).filter((s): s is SessionRow => s !== null);
    const newest = new Set(rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, keep).map((s) => s.id));
    for (const s of rows) if (s.id !== protect && !newest.has(s.id)) await this.deleteSession(s.id);
  }
  async deleteExpiredSessions(now: number) {
    for (const key of await this.kv.list("sess:")) {
      const s = await this.get<SessionRow>(key);
      if (s && s.expiresAt <= now) await this.deleteSession(s.id);
    }
  }

  getOnboarding(workspaceId: string) {
    return this.get<OnboardingDoc>(`onb:${workspaceId}`);
  }
  async putOnboarding(workspaceId: string, doc: OnboardingDoc) {
    await this.kv.put(`onb:${workspaceId}`, doc);
  }
  async deleteOnboarding(workspaceId: string) {
    await this.kv.delete(`onb:${workspaceId}`);
  }

  hit(key: string, windowMs: number, now: number): Promise<CounterState> {
    return serial(`auth:ctr:${key}`, async () => {
      const prev = await this.get<CounterState>(`ctr:${key}`);
      const next = !prev || prev.at <= now - windowMs ? { count: 1, at: now } : { count: prev.count + 1, at: prev.at };
      await this.kv.put(`ctr:${key}`, next);
      return next;
    });
  }
  fail(key: string, resetMs: number, now: number): Promise<CounterState> {
    return serial(`auth:ctr:${key}`, async () => {
      const prev = await this.get<CounterState>(`ctr:${key}`);
      const next = { count: !prev || prev.at <= now - resetMs ? 1 : prev.count + 1, at: now };
      await this.kv.put(`ctr:${key}`, next);
      return next;
    });
  }
  peek(key: string) {
    return this.get<CounterState>(`ctr:${key}`);
  }
  async clear(key: string) {
    await this.kv.delete(`ctr:${key}`);
  }
  async deleteExpiredCounters(before: number) {
    for (const key of await this.kv.list("ctr:")) {
      const c = await this.get<CounterState>(key);
      if (c && c.at < before) await this.kv.delete(key);
    }
  }
}
