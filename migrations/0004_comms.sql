-- Local Edition D1 schema, step 4 (lane B3: Slack + mail). One generic document table keeps the connector state small:
--   kind = slack_install | mail_conn | target | event | delivery | thread | note | suggestion | digest
-- `ref` is a secondary lookup key (Slack team id, Composio connected-account id, mail thread id). Tokens never sit in plain text:
-- Slack bot tokens are AES-GCM encrypted per workspace (src/server/connectors/comms/crypto.ts) before they reach `json`.
CREATE TABLE IF NOT EXISTS comms_docs (
  workspace_id  TEXT NOT NULL,
  kind          TEXT NOT NULL,
  key           TEXT NOT NULL,
  ref           TEXT,
  json          TEXT NOT NULL,
  at            TEXT NOT NULL,
  PRIMARY KEY (workspace_id, kind, key)
);
CREATE INDEX IF NOT EXISTS comms_docs_ref ON comms_docs (kind, ref);
CREATE INDEX IF NOT EXISTS comms_docs_at ON comms_docs (workspace_id, kind, at);

-- Idempotency: a button double click, a Slack retry or a repeated Composio delivery claims its key once.
CREATE TABLE IF NOT EXISTS comms_claims (
  key  TEXT PRIMARY KEY,
  at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comms_claims_at ON comms_claims (at);
