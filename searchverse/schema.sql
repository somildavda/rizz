-- Searchverse D1 schema. Apply with:
--   npx wrangler d1 execute searchverse --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  picture TEXT,
  gemini_key_enc TEXT,
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
  connected_at INTEGER,
  expired INTEGER DEFAULT 0,
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
  role TEXT DEFAULT 'editor',          -- 'editor' (can run analyses, default) | 'viewer' (view only)
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

-- LOB (line of business) URL groups and their stored monthly GSC numbers
CREATE TABLE IF NOT EXISTS lob_groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  patterns TEXT NOT NULL,
  sort INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lob_project ON lob_groups (project_id, sort);

-- group_id '__site__' holds whole-property totals
CREATE TABLE IF NOT EXISTS lob_monthly (
  project_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  month TEXT NOT NULL,          -- YYYY-MM
  clicks REAL,
  impressions REAL,
  ctr REAL,
  position REAL,
  days INTEGER,
  updated_at INTEGER,
  PRIMARY KEY (project_id, group_id, month)
);

-- Extra per-project settings (e.g. money_pages)
CREATE TABLE IF NOT EXISTS project_meta (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (project_id, key)
);

-- Large run exports (full GSC query/page lists), stored in chunks
CREATE TABLE IF NOT EXISTS run_blobs (
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  data TEXT,
  PRIMARY KEY (run_id, kind, chunk)
);

-- GA4 numbers per LOB group and period ('YYYY-MM' months, 'YYYY-Www' ISO weeks)
CREATE TABLE IF NOT EXISTS lob_ga (
  project_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  period TEXT NOT NULL,
  sessions REAL,
  new_users REAL,
  total_users REAL,
  views REAL,
  key_events REAL,
  leads REAL,
  bounce_sessions REAL,
  days INTEGER,
  updated_at INTEGER,
  PRIMARY KEY (project_id, group_id, period)
);

-- App-wide settings (e.g. data retention)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Which storage database holds a run's crawled pages & exports (main or DATA1..DATA9)
CREATE TABLE IF NOT EXISTS run_shard (
  run_id TEXT PRIMARY KEY,
  shard TEXT NOT NULL
);

-- AI answer visibility: prompts to track and each check's result
CREATE TABLE IF NOT EXISTS ai_prompts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_checks (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_at INTEGER,
  engine TEXT,
  model TEXT,
  answer TEXT,
  search_queries TEXT,
  sources TEXT,
  mentioned INTEGER,
  cited INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_checks ON ai_checks (project_id, run_at);
