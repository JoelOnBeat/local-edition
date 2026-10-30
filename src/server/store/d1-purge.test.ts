import { afterAll, describe, expect, it } from "vitest";
import type { D1Like } from "../platform/types";
import { createD1Repo } from "./d1";
import { CONNECTOR_TABLES, JOB_RUN_KEEP_MS, PURGE_CHUNK, PURGE_MAX_ROUNDS } from "./d1-purge";
import { openTestD1, wipe } from "./d1-test-utils";
import { cardFor, cleanEdition } from "../../../tests/e/helpers";
import { sampleSeed } from "@/server/sample/chain";
import type { SeedWithId } from "./keyed-repo";

const NOW = Date.UTC(2026, 10, 2, 0, 0);
const DAY = 24 * 3600 * 1000;
let opened: Awaited<ReturnType<typeof openTestD1>> | undefined;
const open = async (): Promise<D1Like> => {
  opened ??= await openTestD1();
  await wipe(opened.db);
  return opened.db;
};
afterAll(async () => { await opened?.dispose(); });
const count = async (db: D1Like, table: string, where = "1 = 1") => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())!.n;

/** `n` visitor workspaces expiring at `expiredAt`, each with a chain, a store, a card-less edition and a menu, as plain rows. */
async function seedWorkspaces(db: D1Like, n: number, expiredAt: number, tag = "old") {
  for (let from = 0; from < n; from += 100) {
    const statements = [];
    for (let i = from; i < Math.min(n, from + 100); i++) {
      const ws = `ws_${tag}${i}`;
      statements.push(
        db.prepare("INSERT INTO workspaces (id, chain_id, created_at, expires_at) VALUES (?, ?, 'x', ?)").bind(ws, `c${tag}${i}`, expiredAt),
        db.prepare("INSERT INTO chains (id, workspace_id, json) VALUES (?, ?, '{}')").bind(`c${tag}${i}`, ws),
        db.prepare("INSERT INTO stores (id, workspace_id, chain_id, json) VALUES (?, ?, ?, '{}')").bind(`s${tag}${i}`, ws, `c${tag}${i}`),
        db.prepare("INSERT INTO menus (chain_id, workspace_id, json) VALUES (?, ?, '[]')").bind(`c${tag}${i}`, ws),
        db.prepare("INSERT INTO editions (id, workspace_id, store_id, week_of, status, rev, json) VALUES (?, ?, ?, '2026-10-26', 'draft', 0, '{}')").bind(`e${tag}${i}`, ws, `s${tag}${i}`),
        db.prepare("INSERT INTO staff_cards (edition_id, workspace_id, token, json) VALUES (?, ?, ?, '{}')").bind(`e${tag}${i}`, ws, `tok${tag}${i}`),
        db.prepare("INSERT INTO build_runs (id, workspace_id, status, total, done, created_at, updated_at) VALUES (?, ?, 'done', 1, 1, ?, ?)").bind(`r${tag}${i}`, ws, NOW, NOW),
        db.prepare("INSERT INTO build_events (run_id, seq, workspace_id, json, created_at) VALUES (?, 1, ?, '{}', ?)").bind(`r${tag}${i}`, ws, NOW),
      );
    }
    await db.batch(statements);
  }
}

describe("L6: purge scale and indexes", () => {
  it("has workspace_id indexes on staff_cards, menus and build_events, and the purge's lookups use them", async () => {
    const db = await open();
    for (const [table, index] of [["staff_cards", "staff_cards_workspace"], ["menus", "menus_workspace"], ["build_events", "build_events_workspace"]]) {
      const plan = (await db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM ${table} WHERE workspace_id = ?`).bind("w").all<{ detail: string }>()).results!;
      expect(plan.map((r) => r.detail).join(" "), table).toContain(index);
    }
  });

  it("purges 1,300 expired workspaces in a few batches, far under 1,000 queries, and keeps live ones", async () => {
    const db = await open();
    await seedWorkspaces(db, 1300, NOW - DAY);
    await seedWorkspaces(db, 3, NOW + 5 * DAY, "live");
    let queries = 0;
    const counted: D1Like = { prepare: (q) => { queries++; return db.prepare(q); }, batch: (b) => db.batch(b) };
    const repo = createD1Repo(async () => counted, { now: () => NOW });
    expect(await repo.purgeExpired()).toBe(1300);
    expect(queries).toBeLessThan(200);
    expect(PURGE_MAX_ROUNDS * PURGE_CHUNK).toBeGreaterThanOrEqual(10_000);
    for (const t of ["workspaces", "chains", "stores", "menus", "editions", "staff_cards", "build_runs", "build_events"]) expect(await count(db, t), t).toBe(t === "workspaces" ? 3 : 3);
    expect(await count(db, "stores", "workspace_id LIKE 'ws_old%'")).toBe(0);
  }, 60_000);

  it("purges a smaller backlog in one run and a second run finds nothing", async () => {
    const db = await open();
    await seedWorkspaces(db, 120, NOW - DAY);
    const repo = createD1Repo(async () => db, { now: () => NOW });
    expect(await repo.purgeExpired()).toBe(120);
    expect(await repo.purgeExpired()).toBe(0);
  });

  it("calls onExpired with the ids first, and keeps the rows when it throws", async () => {
    const db = await open();
    await seedWorkspaces(db, 4, NOW - DAY);
    const seen: string[][] = [];
    const failing = createD1Repo(async () => db, { now: () => NOW, onExpired: async (ids) => { seen.push(ids); throw new Error("r2 down"); } });
    expect(await failing.purgeExpired()).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].sort()).toEqual(["ws_old0", "ws_old1", "ws_old2", "ws_old3"]);
    expect(await count(db, "workspaces")).toBe(4);
    const ok = createD1Repo(async () => db, { now: () => NOW, onExpired: async () => undefined });
    expect(await ok.purgeExpired()).toBe(4);
    expect(await count(db, "stores")).toBe(0);
  });

  it("purges job runs older than 60 days and keeps newer ones", async () => {
    const db = await open();
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    await db.batch([
      db.prepare("INSERT INTO job_runs (id, started_at, json) VALUES ('old', ?, '{}')").bind(at(JOB_RUN_KEEP_MS + DAY)),
      db.prepare("INSERT INTO job_runs (id, started_at, json) VALUES ('new', ?, '{}')").bind(at(JOB_RUN_KEEP_MS - DAY)),
    ]);
    await createD1Repo(async () => db, { now: () => NOW }).purgeExpired();
    expect((await db.prepare("SELECT id FROM job_runs").all<{ id: string }>()).results).toEqual([{ id: "new" }]);
  });
});

describe("L6/L7: workspace_id on every row, and reads that respect it", () => {
  const seed = (id: string) => ({ ...sampleSeed(), workspaceId: id }) as SeedWithId;

  it("never stores workspace_id '' : a row whose parent is missing is stamped orphan:<parent> and the purge removes it", async () => {
    const db = await open();
    const repo = createD1Repo(async () => db, { now: () => NOW });
    const edition = { ...cleanEdition("store_williamsburg", "ed_orphan"), storeId: "store_gone" };
    await repo.putEdition(edition);
    await repo.putStaffCard(cardFor(edition));
    await repo.putStore({ id: "s_orphan", chainId: "chain_gone", name: "x" } as never);
    await repo.replaceMenu("chain_gone", []);
    for (const t of ["stores", "menus", "editions", "staff_cards", "chains"]) expect(await count(db, t, "workspace_id = ''"), t).toBe(0);
    expect(await count(db, "editions", "workspace_id = 'orphan:store_gone'")).toBe(1);
    expect((await repo.getEdition("ed_orphan"))?.id).toBe("ed_orphan"); // still readable while it exists
    await repo.purgeExpired();
    for (const t of ["stores", "menus", "editions", "staff_cards"]) expect(await count(db, t, "workspace_id LIKE 'orphan:%'"), t).toBe(0);
  });

  it("stamps the parent's workspace and does not read a row under a parent from another workspace", async () => {
    const db = await open();
    const repo = createD1Repo(async () => db, { now: () => NOW });
    await repo.createWorkspace(seed("ws_a"));
    const edition = cleanEdition();
    await repo.putEdition(edition);
    await repo.putStaffCard(cardFor(edition, "tok_guard_0000000001"));
    expect(await count(db, "editions", "workspace_id = 'ws_a'")).toBe(1);
    expect((await repo.getEdition(edition.id))?.id).toBe(edition.id);
    // Corrupt them one at a time: a row whose workspace_id differs from its parent's is not served.
    await db.prepare("UPDATE staff_cards SET workspace_id = 'ws_b' WHERE edition_id = ?").bind(edition.id).run();
    expect(await repo.getStaffCardByEdition(edition.id)).toBeNull();
    expect(await repo.getStaffCardByToken("tok_guard_0000000001")).toBeNull();
    await db.prepare("UPDATE editions SET workspace_id = 'ws_b' WHERE id = ?").bind(edition.id).run();
    expect(await repo.getEdition(edition.id)).toBeNull();
    expect(await repo.getEditionForWeek(edition.storeId, edition.weekOf)).toBeNull();
    expect(await repo.listEditions({ storeIds: [edition.storeId] })).toEqual([]);
    await db.prepare("UPDATE stores SET workspace_id = 'ws_b' WHERE id = ?").bind(edition.storeId).run();
    expect(await repo.getStore(edition.storeId)).toBeNull();
    expect((await repo.listStores("chain_kettle_kiln")).some((s) => s.id === edition.storeId)).toBe(false);
  });
});

describe("purge: connector and comms rows", () => {
  /** One row of every connector table for workspace `ws`. */
  async function seedConnectors(db: D1Like, ws: string) {
    await db.batch([
      db.prepare("INSERT INTO comms_docs (workspace_id, kind, key, json, at) VALUES (?, 'note', 'n1', '{}', 'x')").bind(ws),
      db.prepare("INSERT INTO connector_connections (workspace_id, provider, json, mode, meta, updated_at) VALUES (?, 'square', '{}', 'sandbox', '{}', 'x')").bind(ws),
      db.prepare("INSERT INTO connector_events (id, workspace_id, provider, at, json) VALUES (?, ?, 'square', 'x', '{}')").bind(`ev_${ws}`, ws),
      db.prepare("INSERT INTO connector_deliveries (workspace_id, provider, edition_id, at, json) VALUES (?, 'square', 'e1', 'x', '{}')").bind(ws),
      db.prepare("INSERT INTO square_locations (workspace_id, location_id, name) VALUES (?, 'L1', 'Loc')").bind(ws),
      db.prepare("INSERT INTO calendar_tokens (token, workspace_id, scope, created_at) VALUES (?, ?, 'chain', 'x')").bind(`tok_${ws}`, ws),
      db.prepare("INSERT INTO connector_oauth_state (state, workspace_id, provider, expires_at) VALUES (?, ?, 'square', ?)").bind(`st_${ws}`, ws, NOW + DAY),
    ]);
  }

  it("removes an expired workspace's connector and comms rows, keeps a live one's, and trims old claims and spent OAuth states", async () => {
    const db = await open();
    await db.batch([...CONNECTOR_TABLES, "comms_claims"].map((t) => db.prepare(`DELETE FROM ${t}`)));
    await seedWorkspaces(db, 2, NOW - DAY);
    await seedWorkspaces(db, 1, NOW + 5 * DAY, "live");
    await seedConnectors(db, "ws_old0");
    await seedConnectors(db, "ws_old1");
    await seedConnectors(db, "ws_live0");
    await db.batch([
      db.prepare("INSERT INTO comms_claims (key, at) VALUES ('stale', ?)").bind(NOW - 30 * DAY),
      db.prepare("INSERT INTO comms_claims (key, at) VALUES ('fresh', ?)").bind(NOW - DAY),
      db.prepare("INSERT INTO connector_oauth_state (state, workspace_id, provider, expires_at) VALUES ('spent', 'ws_live0', 'square', ?)").bind(NOW - 1),
    ]);
    const repo = createD1Repo(async () => db, { now: () => NOW });
    expect(await repo.purgeExpired()).toBe(2);
    for (const t of CONNECTOR_TABLES) {
      expect(await count(db, t, "workspace_id LIKE 'ws_old%'"), t).toBe(0);
      expect(await count(db, t, "workspace_id = 'ws_live0'"), t).toBe(1);
    }
    expect(await count(db, "comms_claims")).toBe(1);
    expect(await count(db, "connector_oauth_state", "state = 'spent'")).toBe(0);
  });

  it("still purges the core rows when the connector tables do not exist yet", async () => {
    const own = await openTestD1(); // its own database: the tables are dropped
    try {
      const db = own.db;
      await wipe(db);
      await seedWorkspaces(db, 3, NOW - DAY);
      await db.batch([...CONNECTOR_TABLES, "comms_claims"].map((t) => db.prepare(`DROP TABLE ${t}`)));
      const repo = createD1Repo(async () => db, { now: () => NOW });
      expect(await repo.purgeExpired()).toBe(3);
      expect(await count(db, "workspaces", "id LIKE 'ws_old%'")).toBe(0);
    } finally {
      await own.dispose();
    }
  });
});
