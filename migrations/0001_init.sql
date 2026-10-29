-- Local Edition D1 schema. One database; every table that belongs to a visitor carries workspace_id
-- ('' on global rows: evidence, cache, locks, job runs). JSON columns hold the contract's zod shapes,
-- indexed columns hold what queries filter on. Applied with `wrangler d1 migrations apply LE_DB`.

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  chain_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  INTEGER
);

CREATE TABLE IF NOT EXISTS chains (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  json          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chains_workspace ON chains (workspace_id);

CREATE TABLE IF NOT EXISTS stores (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  chain_id      TEXT NOT NULL,
  json          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stores_chain ON stores (chain_id);
CREATE INDEX IF NOT EXISTS stores_workspace ON stores (workspace_id);

CREATE TABLE IF NOT EXISTS menus (
  chain_id      TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  json          TEXT NOT NULL
);

-- rev is the optimistic-concurrency counter: every write is `UPDATE ... WHERE id = ? AND rev = ?`.
CREATE TABLE IF NOT EXISTS editions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  store_id      TEXT NOT NULL,
  week_of       TEXT NOT NULL,
  status        TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 0,
  json          TEXT NOT NULL,
  UNIQUE (store_id, week_of)
);
CREATE INDEX IF NOT EXISTS editions_workspace ON editions (workspace_id);

CREATE TABLE IF NOT EXISTS staff_cards (
  edition_id    TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  token         TEXT NOT NULL UNIQUE,
  json          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  json          TEXT NOT NULL,
  expires_at    INTEGER
);

CREATE TABLE IF NOT EXISTS job_runs (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  started_at    TEXT NOT NULL,
  json          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_runs_started ON job_runs (started_at);

CREATE TABLE IF NOT EXISTS locks (
  name          TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  token         TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);

-- Provider cache (Qloo, Tavily). Used only when no KV namespace is bound.
CREATE TABLE IF NOT EXISTS cache (
  key           TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT '',
  json          TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);

-- Workflow runs and their progress events. The SSE route tails build_events by seq.
CREATE TABLE IF NOT EXISTS build_runs (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  status        TEXT NOT NULL,
  total         INTEGER NOT NULL DEFAULT 0,
  done          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS build_runs_workspace ON build_runs (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS build_events (
  run_id        TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  workspace_id  TEXT NOT NULL,
  json          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
