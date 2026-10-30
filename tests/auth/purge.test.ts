import { afterAll, expect, it } from "vitest";
import { purgeExpiredRows } from "@/server/store/d1-purge";
import { openTestD1 } from "@/server/store/d1-test-utils";

const opened = openTestD1();
afterAll(async () => (await opened).dispose());

it("the weekly purge drops an expired visitor's onboarding record, dead sessions and old counters, and keeps an account's", async () => {
  const { db } = await opened;
  const NOW = Date.UTC(2026, 10, 2);
  const run = (sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).run();
  await run("INSERT INTO workspaces (id, chain_id, created_at, expires_at) VALUES ('ws_old', 'c1', 'x', ?)", NOW - 1000);
  await run("INSERT INTO workspaces (id, chain_id, created_at, expires_at) VALUES ('acct_keep', 'c2', 'x', NULL)");
  await run("INSERT INTO onboarding (workspace_id, json, updated_at) VALUES ('ws_old', '{}', 1), ('acct_keep', '{}', 1)");
  await run("INSERT INTO users (id, email, name, password_hash, workspace_id, created_at) VALUES ('user_1', 'a@b.co', 'A', 'h', 'acct_keep', 'x')");
  await run("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES ('dead', 'user_1', 1, 1, ?), ('live', 'user_1', 1, 1, ?)", NOW - 1, NOW + 100_000);
  await run("INSERT INTO auth_counters (key, count, at) VALUES ('old', 3, ?), ('new', 3, ?)", NOW - 3 * 24 * 3600 * 1000, NOW - 1000);

  expect(await purgeExpiredRows(async () => db, NOW)).toBe(1);

  const ids = async (sql: string) => ((await db.prepare(sql).all<{ k: string }>()).results ?? []).map((r) => r.k);
  expect(await ids("SELECT workspace_id AS k FROM onboarding")).toEqual(["acct_keep"]);
  expect(await ids("SELECT id AS k FROM sessions")).toEqual(["live"]);
  expect(await ids("SELECT key AS k FROM auth_counters")).toEqual(["new"]);
  expect(await ids("SELECT id AS k FROM users")).toEqual(["user_1"]);
  expect(await ids("SELECT id AS k FROM workspaces")).toEqual(["acct_keep"]);
});
