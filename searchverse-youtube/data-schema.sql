-- Schema for extra free storage databases (DATA1..DATA9). Created by `npm run add-storage`.
CREATE TABLE IF NOT EXISTS audit_blobs (
  audit_id TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  data BLOB,
  PRIMARY KEY (audit_id, chunk)
);
