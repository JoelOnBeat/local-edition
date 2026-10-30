-- Local Edition D1 schema, step 5: accounts, sessions and onboarding progress (lane: auth, 30 Oct).
-- Email and password only (no email provider yet). Plain passwords are never stored: password_hash is
-- pbkdf2-sha256$<iterations>$<salt>$<hash> (src/server/auth/password.ts). A session cookie holds a random token, only its SHA-256
-- is stored, so a copy of this table cannot be used to sign in.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,            -- normalised: NFKC, trimmed, lower-case
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  workspace_id   TEXT NOT NULL UNIQUE,            -- the account's workspace (acct_...), one per user
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,                 -- SHA-256 (hex) of the cookie token
  user_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);

-- Onboarding progress, one document per workspace (the account's, or a sample visitor's).
CREATE TABLE IF NOT EXISTS onboarding (
  workspace_id  TEXT PRIMARY KEY,
  json          TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Atomic counters for sign-in / sign-up rate limits and failure back-off. Keys are hashes (never a raw address or email).
-- at is the window start for a rate-limit counter and the time of the last failure for a failure counter.
CREATE TABLE IF NOT EXISTS auth_counters (
  key    TEXT PRIMARY KEY,
  count  INTEGER NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_counters_at ON auth_counters (at);
