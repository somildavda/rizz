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
