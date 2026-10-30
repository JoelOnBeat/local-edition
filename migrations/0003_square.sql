-- Connectors (lane B2: Square and the calendar feed). Tables with a `provider` column are shared with the other connectors
-- (Slack, mail): they read and write them through src/server/connectors/ledger.ts. Secrets here are ciphertext only
-- (AES-GCM, key from the Worker secret SQUARE_TOKEN_KEY); a plaintext token never reaches D1.

CREATE TABLE IF NOT EXISTS connector_connections (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  json              TEXT NOT NULL,                -- the contract's Connection (never a token)
  mode              TEXT NOT NULL,                -- sandbox | production
  merchant_id       TEXT,                         -- provider-side account id, used to route webhooks
  token_enc         TEXT,                         -- ciphertext: v1.<iv>.<data>, additional data = workspace id
  refresh_enc       TEXT,
  token_expires_at  TEXT,
  meta              TEXT NOT NULL DEFAULT '{}',   -- non-secret provider state (last webhook, catalog time)
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, provider)
);
CREATE INDEX IF NOT EXISTS connector_connections_merchant ON connector_connections (provider, merchant_id);

-- The sync log the connections page shows, newest first.
CREATE TABLE IF NOT EXISTS connector_events (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  provider      TEXT NOT NULL,
  at            TEXT NOT NULL,
  json          TEXT NOT NULL                     -- the contract's SyncEvent
);
CREATE INDEX IF NOT EXISTS connector_events_workspace ON connector_events (workspace_id, at);

-- Where an approved edition item went. item_id is '' for a delivery of the whole edition.
CREATE TABLE IF NOT EXISTS connector_deliveries (
  workspace_id  TEXT NOT NULL,
  provider      TEXT NOT NULL,
  edition_id    TEXT NOT NULL,
  item_id       TEXT NOT NULL DEFAULT '',
  at            TEXT NOT NULL,
  json          TEXT NOT NULL,                    -- the contract's Delivery
  PRIMARY KEY (workspace_id, provider, edition_id, item_id)
);
CREATE INDEX IF NOT EXISTS connector_deliveries_edition ON connector_deliveries (edition_id);

-- Square location <-> Local Edition store.
CREATE TABLE IF NOT EXISTS square_locations (
  workspace_id  TEXT NOT NULL,
  location_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  store_id      TEXT,
  PRIMARY KEY (workspace_id, location_id)
);
CREATE INDEX IF NOT EXISTS square_locations_store ON square_locations (workspace_id, store_id);

-- One-use OAuth `state` values (CSRF). Consumed on the callback; expired rows are ignored and purged on the next write.
CREATE TABLE IF NOT EXISTS connector_oauth_state (
  state         TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  provider      TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);

-- Unguessable calendar feed tokens: one per (workspace, scope, store). Scope `chain` has store_id ''.
CREATE TABLE IF NOT EXISTS calendar_tokens (
  token         TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  scope         TEXT NOT NULL,
  store_id      TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (workspace_id, scope, store_id)
);
