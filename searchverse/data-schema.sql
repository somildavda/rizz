-- Schema for extra free storage databases (DATA1..DATA9). Created by `npm run add-storage`.
CREATE TABLE IF NOT EXISTS pages (
  run_id TEXT NOT NULL,
  url TEXT NOT NULL,
  onpage_score INTEGER,
  content_score INTEGER,
  data_json TEXT,
  PRIMARY KEY (run_id, url)
);
CREATE TABLE IF NOT EXISTS run_blobs (
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  data TEXT,
  PRIMARY KEY (run_id, kind, chunk)
);
