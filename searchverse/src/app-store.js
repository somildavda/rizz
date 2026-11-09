// Accounts, sessions and usage analytics for SearchVerse: one SQLite Durable Object
// ("main"), created automatically on deploy (see wrangler.jsonc). Works on the free plan.
//
// - The first account ever created becomes the owner (approved). Everyone else starts as
//   "pending" and can only sign in after an owner or team admin approves them.
// - Roles: owner > admin (team admin) > manager (project manager) > member > viewer.
// - Passwords: PBKDF2-SHA256 with a per-user salt. Sessions: random token in an HttpOnly
//   cookie; only its SHA-256 hash is stored.
// - Events: page views (with time on page), tool clicks, sign-ups and logins, with country,
//   device and referrer.

import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
// 20k iterations keeps a login well inside the free plan's CPU budget.
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 20000 }, key, 256));
}
const SESSION_DAYS = 30;
const DAY = 86400000;

export class AppStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        pass TEXT NOT NULL, salt TEXT NOT NULL, status TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
        note TEXT, created_at INTEGER NOT NULL, approved_at INTEGER, last_login INTEGER);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id INTEGER, visitor TEXT,
        type TEXT NOT NULL, path TEXT, tool TEXT, title TEXT, duration INTEGER,
        country TEXT, device TEXT, referrer TEXT);
      CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS events_user ON events(user_id, ts);
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, n INTEGER NOT NULL, since INTEGER NOT NULL);
    `);
    // Older accounts used "admin"/"user"; they become owner/member.
    this.sql.exec("UPDATE users SET role = 'owner' WHERE role = 'admin' AND id = (SELECT MIN(id) FROM users)");
    this.sql.exec("UPDATE users SET role = 'member' WHERE role = 'user'");
  }
  rows(q, ...a) { return this.sql.exec(q, ...a).toArray(); }
  one(q, ...a) { return this.rows(q, ...a)[0] || null; }

  // Blocks more than 10 tries per email (or IP) in 15 minutes.
  limited(key) {
    const now = Date.now(), r = this.one("SELECT n, since FROM attempts WHERE key = ?", key);
    if (!r || now - r.since > 15 * 60000) { this.sql.exec("INSERT OR REPLACE INTO attempts (key, n, since) VALUES (?, 1, ?)", key, now); return false; }
    this.sql.exec("UPDATE attempts SET n = n + 1 WHERE key = ?", key);
    return r.n >= 10;
  }

  async fetch(request) {
    const url = new URL(request.url), path = url.pathname, m = request.method, now = Date.now();
    const body = m === "POST" ? await request.json().catch(() => ({})) : {};

    // ---- who is this? (called by the Worker on every request) ----
    if (path === "/session") {
      const tok = body.token && await sha256(body.token);
      const r = tok && this.one(`SELECT u.id, u.name, u.email, u.status, u.role FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?`, tok, now);
      return json({ user: r || null });
    }

    if (path === "/signup") {
      const name = String(body.name || "").trim().slice(0, 80), email = String(body.email || "").trim().toLowerCase().slice(0, 200), pw = String(body.password || "");
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter your name and a valid email." }, 400);
      if (pw.length < 8) return json({ error: "Use a password of at least 8 characters." }, 400);
      if (this.limited("ip:" + body.ip)) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
      if (this.one("SELECT id FROM users WHERE email = ?", email)) return json({ error: "That email already has an account — sign in instead." }, 409);
      const first = !this.one("SELECT id FROM users LIMIT 1");
      const salt = randomHex(16), pass = await hashPassword(pw, salt);
      const u = this.one(`INSERT INTO users (name, email, pass, salt, status, role, note, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        name, email, pass, salt, first ? "approved" : "pending", first ? "owner" : "member", String(body.note || "").slice(0, 500), now, first ? now : null);
      this.track({ ...body.meta, type: "signup", user_id: u.id });
      if (!first) return json({ pending: true });
      return json({ ...(await this.newSession(u.id)), admin: true });
    }

    if (path === "/login") {
      const email = String(body.email || "").trim().toLowerCase();
      if (this.limited("email:" + email) || this.limited("ip:" + body.ip)) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
      const u = this.one("SELECT * FROM users WHERE email = ?", email);
      if (!u || (await hashPassword(String(body.password || ""), u.salt)) !== u.pass) return json({ error: "Wrong email or password." }, 401);
      if (u.status === "pending") return json({ error: "Your access request is waiting for approval. You'll be able to sign in once it's approved." }, 403);
      if (u.status !== "approved") return json({ error: "This account doesn't have access." }, 403);
      this.sql.exec("UPDATE users SET last_login = ? WHERE id = ?", now, u.id);
      this.sql.exec("DELETE FROM attempts WHERE key = ?", "email:" + email);
      this.track({ ...body.meta, type: "login", user_id: u.id });
      return json(await this.newSession(u.id));
    }

    if (path === "/logout") {
      if (body.token) this.sql.exec("DELETE FROM sessions WHERE token = ?", await sha256(body.token));
      return json({ ok: true });
    }

    if (path === "/track") { this.track(body); return json({ ok: true }); }

    // ---- admin only (the Worker checks the role before forwarding) ----
    if (path === "/admin/users") {
      return json(this.rows(`SELECT u.id, u.name, u.email, u.status, u.role, u.note, u.created_at, u.approved_at, u.last_login,
          (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.type = 'click') AS clicks,
          (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.type = 'view') AS views,
          (SELECT MAX(ts) FROM events e WHERE e.user_id = u.id) AS last_seen
        FROM users u ORDER BY CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, u.created_at DESC`));
    }
    // Change someone's access and/or role. `by` is the signed-in person (set by the Worker).
    // Owners can give any role except owner; team admins can approve people and give
    // project manager, member or viewer, but can't change owners or other admins.
    if (path === "/admin/user" && m === "POST") {
      const id = Number(body.id), st = body.status, role = body.role, by = body.by || {};
      const u = this.one("SELECT role FROM users WHERE id = ?", id);
      if (!u) return json({ error: "No such person" }, 404);
      if (u.role === "owner") return json({ error: "The owner's account can't be changed." }, 400);
      if (by.role !== "owner" && u.role === "admin") return json({ error: "Only the owner can change a team admin." }, 403);
      if (st != null) {
        if (!["approved", "rejected", "pending"].includes(st)) return json({ error: "Bad status" }, 400);
        this.sql.exec("UPDATE users SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END WHERE id = ?", st, st, now, id);
        if (st !== "approved") this.sql.exec("DELETE FROM sessions WHERE user_id = ?", id);
      }
      if (role != null) {
        const allowed = by.role === "owner" ? ["admin", "manager", "member", "viewer"] : ["manager", "member", "viewer"];
        if (!allowed.includes(role)) return json({ error: "You can't give that role." }, 403);
        this.sql.exec("UPDATE users SET role = ? WHERE id = ?", role, id);
      }
      return json({ ok: true });
    }
    if (path === "/admin/stats") {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30)), from = now - days * DAY;
      const q = (sql, ...a) => this.rows(sql, from, ...a);
      const who = "COALESCE(CAST(user_id AS TEXT), visitor)";
      return json({
        days,
        totals: this.one(`SELECT COUNT(*) AS views, COUNT(DISTINCT ${who}) AS visitors,
            (SELECT COUNT(*) FROM events WHERE ts >= ?1 AND type = 'click') AS clicks,
            (SELECT COUNT(*) FROM events WHERE ts >= ?1 AND type = 'login') AS logins,
            (SELECT COUNT(*) FROM events WHERE ts >= ?1 AND type = 'signup') AS signups,
            (SELECT ROUND(AVG(duration) / 1000.0) FROM events WHERE ts >= ?1 AND type = 'view' AND duration > 0) AS avg_seconds
          FROM events WHERE ts >= ?1 AND type = 'view'`, from),
        pending: this.one("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").n,
        users: this.one("SELECT COUNT(*) AS n FROM users WHERE status = 'approved'").n,
        daily: q(`SELECT CAST((ts / 86400000) AS INTEGER) AS day, COUNT(CASE WHEN type = 'view' THEN 1 END) AS views,
            COUNT(DISTINCT ${who}) AS visitors, COUNT(CASE WHEN type = 'click' THEN 1 END) AS clicks, COUNT(CASE WHEN type = 'login' THEN 1 END) AS logins
          FROM events WHERE ts >= ? GROUP BY day ORDER BY day`),
        tools: q(`SELECT tool, COUNT(*) AS clicks, COUNT(DISTINCT ${who}) AS people FROM events WHERE ts >= ? AND type = 'click' AND tool IS NOT NULL GROUP BY tool ORDER BY clicks DESC`),
        pages: q(`SELECT path, MAX(title) AS title, COUNT(*) AS views, COUNT(DISTINCT ${who}) AS people, ROUND(AVG(CASE WHEN duration > 0 THEN duration END) / 1000.0) AS avg_seconds
          FROM events WHERE ts >= ? AND type = 'view' GROUP BY path ORDER BY views DESC LIMIT 50`),
        countries: q(`SELECT COALESCE(country, '?') AS name, COUNT(DISTINCT ${who}) AS people FROM events WHERE ts >= ? GROUP BY name ORDER BY people DESC LIMIT 20`),
        devices: q(`SELECT COALESCE(device, '?') AS name, COUNT(DISTINCT ${who}) AS people FROM events WHERE ts >= ? GROUP BY name ORDER BY people DESC`),
        referrers: q(`SELECT COALESCE(NULLIF(referrer, ''), '(direct)') AS name, COUNT(*) AS visits FROM events WHERE ts >= ? AND type = 'view' GROUP BY name ORDER BY visits DESC LIMIT 20`),
      });
    }
    if (path === "/admin/activity") {
      const uid = url.searchParams.get("user"), type = url.searchParams.get("type");
      const where = ["1 = 1"], args = [];
      if (uid) { where.push("e.user_id = ?"); args.push(Number(uid)); }
      if (type) { where.push("e.type = ?"); args.push(type); }
      return json(this.rows(`SELECT e.ts, e.type, e.path, e.tool, e.title, e.duration, e.country, e.device, e.referrer, u.name, u.email
        FROM events e LEFT JOIN users u ON u.id = e.user_id WHERE ${where.join(" AND ")} ORDER BY e.ts DESC LIMIT 500`, ...args));
    }
    return json({ error: "Not found" }, 404);
  }

  async newSession(userId) {
    const token = randomHex(32), now = Date.now();
    this.sql.exec("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", await sha256(token), userId, now, now + SESSION_DAYS * DAY);
    this.sql.exec("DELETE FROM sessions WHERE expires_at < ?", now);
    return { token, maxAge: SESSION_DAYS * 86400 };
  }

  track(e) {
    const type = String(e.type || "");
    if (!["view", "click", "login", "signup"].includes(type)) return;
    this.sql.exec(`INSERT INTO events (ts, user_id, visitor, type, path, tool, title, duration, country, device, referrer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      Date.now(), e.user_id || null, String(e.visitor || "").slice(0, 40) || null, type, String(e.path || "").slice(0, 300) || null,
      String(e.tool || "").slice(0, 80) || null, String(e.title || "").slice(0, 200) || null, Math.max(0, Math.min(3600000, Number(e.duration) || 0)) || null,
      String(e.country || "").slice(0, 4) || null, String(e.device || "").slice(0, 20) || null, String(e.referrer || "").slice(0, 200) || null);
    // Keep a year of events.
    if (Math.random() < 0.01) this.sql.exec("DELETE FROM events WHERE ts < ?", Date.now() - 365 * DAY);
  }
}
