-- Searchverse YouTube Audit: D1 schema. Apply with: npm run db:init
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  picture TEXT,
  role TEXT NOT NULL DEFAULT 'member',   -- 'admin' | 'member'
  disabled INTEGER NOT NULL DEFAULT 0,
  invited_by TEXT,
  last_login INTEGER,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  mode TEXT NOT NULL,                    -- 'login' | 'youtube' | 'mail'
  email TEXT,
  created_at INTEGER NOT NULL
);

-- "Connect YouTube": the Google account that owns the channel (may differ from the sign-in account)
CREATE TABLE IF NOT EXISTS yt_connections (
  owner_email TEXT PRIMARY KEY,
  google_email TEXT,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires INTEGER,
  connected_at INTEGER,
  expired INTEGER DEFAULT 0
);

-- Admins' own Gmail / Workspace mailbox used to send invite emails (gmail.send only)
CREATE TABLE IF NOT EXISTS mail_senders (
  owner_email TEXT PRIMARY KEY,
  google_email TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires INTEGER,
  connected_at INTEGER,
  expired INTEGER DEFAULT 0
);

-- Daily usage counters (day = Pacific date, when YouTube quota resets)
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- yt_units | ai_text | ai_vision | ai_image | gemini
  amount INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);

-- Shared cache of YouTube responses (gzip), so repeat audits cost 0 units
CREATE TABLE IF NOT EXISTS yt_cache (
  key TEXT PRIMARY KEY,
  data BLOB,
  expires_at INTEGER NOT NULL
);

-- Saved audits; the compressed data lives in audit_blobs on the chosen shard
CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  name TEXT,
  created_at INTEGER,
  summary_json TEXT,
  bytes INTEGER,
  shard TEXT NOT NULL DEFAULT 'DB'
);
CREATE INDEX IF NOT EXISTS idx_audits_created ON audits (created_at);

CREATE TABLE IF NOT EXISTS audit_blobs (
  audit_id TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  data BLOB,
  PRIMARY KEY (audit_id, chunk)
);
