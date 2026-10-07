// Storage + daily limits, mirroring the Searchverse GSC/GA tool:
// - Saved audits are gzip-compressed and stored in D1, spread over the main
//   database plus up to 9 extra free databases (DATA1..DATA9, `npm run add-storage`)
//   → 10 × 500 MB = 5 GB on the free plan.
// - A shared 24h cache of fetched channels (and 7-day cache of competitor
//   suggestions) so repeat audits cost 0 YouTube units.
// - Daily usage counters for YouTube API units and AI calls, with limits.

import { HttpError } from './auth.js';

const DAY_MS = 864e5;
const CHUNK = 900_000; // bytes per row; D1 rows max out at 2 MB
const SHARD_CAP = 500 * 1024 * 1024;

// ── Compression ──────────────────────────────────────────────
export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
const toBytes = (v) => (v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v || []));

// ── Shards (main DB + DATA1..DATA9) ──────────────────────────
export function shards(env) {
  const list = [{ name: 'DB', db: env.DB }];
  for (let i = 1; i <= 9; i++) if (env['DATA' + i]) list.push({ name: 'DATA' + i, db: env['DATA' + i] });
  return list;
}
async function shardSize(db) {
  const r = await db.prepare('SELECT 1').run();
  return r.meta?.size_after || 0;
}
export async function storageStatus(env) {
  const list = shards(env);
  const sizes = await Promise.all(list.map((s) => shardSize(s.db).catch(() => 0)));
  const used = sizes.reduce((a, b) => a + b, 0);
  return { databases: list.map((s, i) => ({ name: s.name, bytes: sizes[i], cap: SHARD_CAP })), used, cap: list.length * SHARD_CAP, maxCap: 10 * SHARD_CAP };
}
async function pickShard(env) {
  const list = shards(env);
  const sizes = await Promise.all(list.map((s) => shardSize(s.db).catch(() => Infinity)));
  let best = 0;
  sizes.forEach((sz, i) => { if (sz < sizes[best]) best = i; });
  if (sizes[best] > SHARD_CAP * 0.95) throw new HttpError('Storage is full. An admin can run "npm run add-storage" (free) or delete old audits.', 507);
  return list[best];
}
const shardDb = (env, name) => (shards(env).find((s) => s.name === name) || shards(env)[0]).db;

// ── Daily usage & limits ─────────────────────────────────────
// YouTube quota resets at midnight Pacific time.
export function pacificDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(now));
}
export function nextPacificMidnight(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const secs = (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second;
  return now + (86400 - secs) * 1000;
}
export const limits = (env) => ({
  yt_units: +env.YT_DAILY_LIMIT || 10000,
  ai_text: +env.AI_TEXT_DAILY || 400,
  ai_vision: +env.AI_VISION_DAILY || 150,
  ai_image: +env.AI_IMAGE_DAILY || 60,
  gemini: +env.GEMINI_DAILY || 200,
});
export async function usageToday(env) {
  const { results } = await env.DB.prepare('SELECT kind, amount FROM usage_daily WHERE day = ?').bind(pacificDay()).all();
  return Object.fromEntries(results.map((r) => [r.kind, r.amount]));
}
export async function addUsage(env, kind, amount) {
  if (!amount) return;
  await env.DB.prepare('INSERT INTO usage_daily (day, kind, amount) VALUES (?, ?, ?) ON CONFLICT(day, kind) DO UPDATE SET amount = amount + excluded.amount')
    .bind(pacificDay(), kind, amount).run();
}
// Throw before starting work that would cross today's limit.
export async function ensureBudget(env, kind, needed) {
  const used = (await usageToday(env))[kind] || 0;
  const cap = limits(env)[kind];
  if (used + needed > cap) {
    const resets = new Date(nextPacificMidnight()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
    const what = kind === 'yt_units' ? `YouTube API limit (${used.toLocaleString()} / ${cap.toLocaleString()} units used today)` : `daily AI limit for this feature (${used} / ${cap})`;
    throw new HttpError(`Today's ${what} is reached. It resets ${resets} IST. Cached channels and saved audits still open.`, 429);
  }
}

// ── Shared cache of YouTube responses ────────────────────────
export async function cacheGet(env, key) {
  const row = await env.DB.prepare('SELECT data, expires_at FROM yt_cache WHERE key = ?').bind(key).first();
  if (!row || row.expires_at < Date.now()) return null;
  return JSON.parse(await gunzip(toBytes(row.data)));
}
export async function cachePut(env, key, value, ttlMs) {
  const data = await gzip(JSON.stringify(value));
  if (data.byteLength > 1_900_000) return; // too big for one row; skip caching
  await env.DB.batch([
    env.DB.prepare('DELETE FROM yt_cache WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('INSERT OR REPLACE INTO yt_cache (key, data, expires_at) VALUES (?, ?, ?)').bind(key, data, Date.now() + ttlMs),
  ]);
}

// ── Saved audits ─────────────────────────────────────────────
// `bytes` is the gzip-compressed audit, compressed by the browser to keep the
// Worker well inside the free plan's CPU limit.
export async function saveAudit(env, user, { name, summary, bytes }) {
  const id = crypto.randomUUID();
  const shard = await pickShard(env);
  const stmts = [];
  for (let i = 0, n = 0; i < bytes.length; i += CHUNK, n++) {
    stmts.push(shard.db.prepare('INSERT INTO audit_blobs (audit_id, chunk, data) VALUES (?, ?, ?)').bind(id, n, bytes.subarray(i, i + CHUNK)));
  }
  for (let i = 0; i < stmts.length; i += 20) await shard.db.batch(stmts.slice(i, i + 20));
  await env.DB.prepare('INSERT INTO audits (id, owner_email, name, created_at, summary_json, bytes, shard) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.email, String(name || 'Audit').slice(0, 200), Date.now(), JSON.stringify(summary || {}), bytes.length, shard.name).run();
  return { id, bytes: bytes.length };
}
export async function listAudits(env) {
  const { results } = await env.DB.prepare('SELECT id, owner_email, name, created_at, summary_json, bytes FROM audits ORDER BY created_at DESC LIMIT 500').all();
  return results.map((r) => ({ ...r, summary: JSON.parse(r.summary_json || '{}'), summary_json: undefined }));
}
export async function loadAudit(env, id) {
  const row = await env.DB.prepare('SELECT * FROM audits WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError('Audit not found.', 404);
  const { results } = await shardDb(env, row.shard).prepare('SELECT data FROM audit_blobs WHERE audit_id = ? ORDER BY chunk').bind(id).all();
  const parts = results.map((r) => toBytes(r.data));
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return { id, name: row.name, created_at: row.created_at, owner_email: row.owner_email, bytes: all };
}
export async function deleteAudit(env, user, id) {
  const row = await env.DB.prepare('SELECT owner_email, shard FROM audits WHERE id = ?').bind(id).first();
  if (!row) return;
  if (row.owner_email !== user.email && user.role !== 'admin') throw new HttpError('Only the person who saved it or an admin can delete this audit.', 403);
  await shardDb(env, row.shard).prepare('DELETE FROM audit_blobs WHERE audit_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM audits WHERE id = ?').bind(id).run();
}
