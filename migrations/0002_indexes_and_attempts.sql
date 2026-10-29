-- Local Edition D1 schema, step 2 (review fixes L2 and L6).

-- L6: the weekly purge deletes by workspace_id (and by age) in every one of these tables; without an index each
-- lookup scanned the table.
CREATE INDEX IF NOT EXISTS staff_cards_workspace ON staff_cards (workspace_id);
CREATE INDEX IF NOT EXISTS menus_workspace ON menus (workspace_id);
CREATE INDEX IF NOT EXISTS build_events_workspace ON build_events (workspace_id);
CREATE INDEX IF NOT EXISTS build_events_created ON build_events (created_at);
CREATE INDEX IF NOT EXISTS build_runs_updated ON build_runs (updated_at);
CREATE INDEX IF NOT EXISTS workspaces_expires ON workspaces (expires_at);
CREATE INDEX IF NOT EXISTS evidence_expires ON evidence (expires_at);
CREATE INDEX IF NOT EXISTS locks_expires ON locks (expires_at);
CREATE INDEX IF NOT EXISTS cache_expires ON cache (expires_at);

-- L2: a Workflow step that is retried writes its events again. `scope` is the store the events belong to, `attempt` the
-- step attempt that wrote them. When a later attempt writes, the earlier attempts' events are marked `superseded` (kept,
-- so `seq` never goes backwards for a client that already read past them) and are no longer replayed.
ALTER TABLE build_events ADD COLUMN scope TEXT NOT NULL DEFAULT '';
ALTER TABLE build_events ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE build_events ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0;
