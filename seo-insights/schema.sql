-- SEO Insights D1 schema. Apply with:
--   npx wrangler d1 execute seo-insights --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  picture TEXT,
  gemini_key_enc TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL
);

-- Google accounts that hold GSC / GA access (can differ from the sign-in account)
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  google_email TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires INTEGER,
  scopes TEXT,
  created_at INTEGER,
  UNIQUE (owner_email, google_email)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  gsc_property TEXT NOT NULL,
  ga4_property TEXT,
  ga4_name TEXT,
  connection_id TEXT,
  max_pages INTEGER DEFAULT 25,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'editor',
  added_at INTEGER,
  PRIMARY KEY (project_id, email)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER,
  status TEXT,
  start_date TEXT,
  end_date TEXT,
  prev_start TEXT,
  prev_end TEXT,
  score INTEGER,
  summary_json TEXT,
  gsc_json TEXT,
  ga_json TEXT,
  ai_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs (project_id, created_at);

CREATE TABLE IF NOT EXISTS pages (
  run_id TEXT NOT NULL,
  url TEXT NOT NULL,
  onpage_score INTEGER,
  content_score INTEGER,
  data_json TEXT,
  PRIMARY KEY (run_id, url)
);
