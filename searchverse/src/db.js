// Project database for the Content Gap tool: a SQLite-backed Durable Object, one per
// workspace. Cloudflare creates it automatically on deploy (see wrangler.jsonc); it
// works on the free plan.
//
// The browser sends its workspace key in the X-Workspace-Key header. The Worker hashes
// it and uses the hash as the Durable Object's name, so each key opens its own private
// database and nothing can list other workspaces.
//
// Routes (all under /api/cg/db/):
//   GET    projects                         list projects
//   GET    projects/:id                     one project
//   PUT    projects/:id                     create or update a project
//   DELETE projects/:id                     delete a project and all its data
//   GET    projects/:id/crawls              scans of a project, newest first
//   POST   projects/:id/crawls              start a scan record -> { id }
//   POST   crawls/:cid/pages                add a batch of crawled pages
//   POST   crawls/:cid/finish               store the scan summary, mark it finished
//   GET    crawls/:cid/pages?site=&offset=  pages of a scan
//   GET    projects/:id/changes             what changed between the last two scans
//   GET    projects/:id/topics              the topic backlog
//   PUT    projects/:id/topics              merge this scan's topics into the backlog
//   PATCH  projects/:id/topics/:key         change a topic's status or notes

import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Statuses the user sets by hand; a re-scan never overwrites them (except to mark a topic covered).
const MANUAL = new Set(["planned", "writing", "published", "dismissed"]);
const STATUSES = new Set(["gap", "covered", "planned", "writing", "published", "dismissed"]);

export class ProjectStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL,
        data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS crawls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL,
        started_at INTEGER NOT NULL, finished_at INTEGER, summary TEXT);
      CREATE INDEX IF NOT EXISTS crawls_project ON crawls(project_id, id);
      CREATE TABLE IF NOT EXISTS pages (
        crawl_id INTEGER NOT NULL, site TEXT NOT NULL, url TEXT NOT NULL, type TEXT,
        title TEXT, h1 TEXT, main_keyword TEXT, keywords TEXT, cluster TEXT,
        depth INTEGER, inlinks INTEGER, PRIMARY KEY (crawl_id, url));
      CREATE INDEX IF NOT EXISTS pages_site ON pages(crawl_id, site);
      CREATE TABLE IF NOT EXISTS topics (
        project_id TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL,
        section TEXT, status TEXT NOT NULL, score INTEGER, data TEXT,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        covered_at INTEGER, covered_url TEXT, notes TEXT, status_changed_at INTEGER,
        PRIMARY KEY (project_id, key));
    `);
    // Added later: each page's H2 headings and word count, used for content briefs.
    const cols = this.sql.exec("PRAGMA table_info(pages)").toArray().map((c) => c.name);
    if (!cols.includes("h2")) this.sql.exec("ALTER TABLE pages ADD COLUMN h2 TEXT");
    if (!cols.includes("words")) this.sql.exec("ALTER TABLE pages ADD COLUMN words INTEGER");
  }

  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.rows(query, ...args)[0] || null; }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/cg\/db\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const m = request.method;
    const body = ["POST", "PUT", "PATCH"].includes(m) ? await request.json().catch(() => null) : null;
    if (["POST", "PUT", "PATCH"].includes(m) && !body) return json({ error: "Bad JSON" }, 400);
    const now = Date.now();

    if (parts[0] === "projects" && parts.length === 1 && m === "GET") {
      const list = this.rows(`SELECT p.id, p.name, p.domain, p.data, p.updated_at,
          (SELECT COUNT(*) FROM crawls c WHERE c.project_id = p.id AND c.finished_at IS NOT NULL) AS scans,
          (SELECT MAX(finished_at) FROM crawls c WHERE c.project_id = p.id) AS last_scan,
          (SELECT COUNT(*) FROM topics t WHERE t.project_id = p.id AND t.status = 'gap') AS gaps
        FROM projects p ORDER BY p.updated_at DESC`);
      return json(list.map((r) => ({ ...JSON.parse(r.data), id: r.id, name: r.name, domain: r.domain, updated_at: r.updated_at, scans: r.scans, last_scan: r.last_scan, gaps: r.gaps })));
    }

    const pid = parts[0] === "projects" ? parts[1] : null;
    if (pid && parts.length === 2) {
      if (m === "GET") {
        const r = this.one("SELECT * FROM projects WHERE id = ?", pid);
        return r ? json({ ...JSON.parse(r.data), id: r.id, name: r.name, domain: r.domain, created_at: r.created_at, updated_at: r.updated_at }) : json({ error: "Not found" }, 404);
      }
      if (m === "PUT") {
        const name = String(body.name || "").slice(0, 200), domain = String(body.domain || "").slice(0, 200);
        if (!name || !domain) return json({ error: "name and domain are required" }, 400);
        const data = { ...body }; delete data.id; delete data.name; delete data.domain;
        this.sql.exec(`INSERT INTO projects (id, name, domain, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain, data = excluded.data, updated_at = excluded.updated_at`,
          pid, name, domain, JSON.stringify(data), now, now);
        return json({ ok: true, id: pid });
      }
      if (m === "DELETE") {
        this.sql.exec("DELETE FROM pages WHERE crawl_id IN (SELECT id FROM crawls WHERE project_id = ?)", pid);
        this.sql.exec("DELETE FROM crawls WHERE project_id = ?", pid);
        this.sql.exec("DELETE FROM topics WHERE project_id = ?", pid);
        this.sql.exec("DELETE FROM projects WHERE id = ?", pid);
        return json({ ok: true });
      }
    }

    if (pid && parts[2] === "crawls" && parts.length === 3) {
      if (m === "GET") {
        return json(this.rows("SELECT id, started_at, finished_at, summary FROM crawls WHERE project_id = ? ORDER BY id DESC LIMIT 100", pid)
          .map((r) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null })));
      }
      if (m === "POST") {
        if (!this.one("SELECT id FROM projects WHERE id = ?", pid)) return json({ error: "Unknown project" }, 404);
        const r = this.one("INSERT INTO crawls (project_id, started_at) VALUES (?, ?) RETURNING id", pid, now);
        return json({ id: r.id });
      }
    }

    const cid = parts[0] === "crawls" ? Number(parts[1]) : null;
    if (cid && parts[2] === "pages" && m === "POST") {
      const pages = Array.isArray(body.pages) ? body.pages.slice(0, 2000) : [];
      if (!this.one("SELECT id FROM crawls WHERE id = ?", cid)) return json({ error: "Unknown scan" }, 404);
      this.ctx.storage.transactionSync(() => {
        for (const p of pages) {
          this.sql.exec(`INSERT OR REPLACE INTO pages (crawl_id, site, url, type, title, h1, main_keyword, keywords, cluster, depth, inlinks, h2, words)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, cid, String(p.site || ""), String(p.url || ""), p.type || null,
            String(p.title || "").slice(0, 300), String(p.h1 || "").slice(0, 300), p.mainKeyword || null,
            JSON.stringify((p.keywords || []).slice(0, 6)), p.cluster || null, Number(p.depth) || 0, Number(p.inlinks) || 0,
            JSON.stringify((p.h2 || []).slice(0, 15).map((x) => String(x).slice(0, 120))), Number(p.words) || 0);
        }
      });
      return json({ ok: true, saved: pages.length });
    }
    if (cid && parts[2] === "pages" && m === "GET") {
      const site = url.searchParams.get("site"), offset = Number(url.searchParams.get("offset")) || 0, limit = Math.min(5000, Number(url.searchParams.get("limit")) || 5000);
      const q = site ? this.rows("SELECT * FROM pages WHERE crawl_id = ? AND site = ? LIMIT ? OFFSET ?", cid, site, limit, offset)
        : this.rows("SELECT * FROM pages WHERE crawl_id = ? LIMIT ? OFFSET ?", cid, limit, offset);
      return json(q.map((r) => ({ ...r, keywords: JSON.parse(r.keywords || "[]"), h2: JSON.parse(r.h2 || "[]") })));
    }
    if (cid && parts[2] === "finish" && m === "POST") {
      this.sql.exec("UPDATE crawls SET finished_at = ?, summary = ? WHERE id = ?", now, JSON.stringify(body.summary || {}), cid);
      return json({ ok: true });
    }

    // What changed between the two latest finished scans: new competitor pages per site.
    if (pid && parts[2] === "changes" && m === "GET") {
      const scans = this.rows("SELECT id, finished_at FROM crawls WHERE project_id = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 2", pid);
      if (scans.length < 2) return json({ previous: null, newPages: [] });
      const [cur, prev] = scans;
      const newPages = this.rows(`SELECT site, url, title, main_keyword, cluster FROM pages
        WHERE crawl_id = ? AND type != 'listing' AND url NOT IN (SELECT url FROM pages WHERE crawl_id = ?) LIMIT 2000`, cur.id, prev.id);
      return json({ previous: prev.finished_at, current: cur.finished_at, newPages });
    }

    if (pid && parts[2] === "topics" && parts.length === 3) {
      if (m === "GET") {
        return json(this.rows("SELECT * FROM topics WHERE project_id = ? ORDER BY CASE status WHEN 'gap' THEN 0 WHEN 'planned' THEN 1 WHEN 'writing' THEN 2 ELSE 3 END, score DESC", pid)
          .map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : {} })));
      }
      // Merge one scan's topics. A topic the brand now has a page for becomes "covered"
      // (remembering when and with which URL); hand-set statuses are otherwise kept.
      if (m === "PUT") {
        const list = Array.isArray(body.topics) ? body.topics.slice(0, 5000) : [];
        const result = { created: [], covered: [], updated: 0 };
        this.ctx.storage.transactionSync(() => {
          for (const t of list) {
            const key = String(t.key || "").slice(0, 200);
            if (!key) continue;
            const old = this.one("SELECT status, covered_at FROM topics WHERE project_id = ? AND key = ?", pid, key);
            let status = t.coveredUrl ? "covered" : "gap";
            if (old && MANUAL.has(old.status) && !(t.coveredUrl && old.status !== "published" && old.status !== "dismissed")) status = old.status;
            if (old && old.status === "published") status = "published";
            const becameCovered = status === "covered" && (!old || old.status !== "covered");
            if (!old) {
              this.sql.exec(`INSERT INTO topics (project_id, key, label, section, status, score, data, first_seen, last_seen, covered_at, covered_url, status_changed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, pid, key, String(t.label || key).slice(0, 200), t.section || null, status,
                Number(t.score) || 0, JSON.stringify(t.data || {}), now, now, t.coveredUrl ? now : null, t.coveredUrl || null, now);
              result.created.push(key);
            } else {
              this.sql.exec(`UPDATE topics SET label = ?, section = COALESCE(?, section), status = ?, score = ?, data = ?, last_seen = ?,
                covered_at = CASE WHEN ? THEN ? ELSE covered_at END, covered_url = COALESCE(?, covered_url),
                status_changed_at = CASE WHEN status != ? THEN ? ELSE status_changed_at END
                WHERE project_id = ? AND key = ?`, String(t.label || key).slice(0, 200), t.section || null, status, Number(t.score) || 0,
                JSON.stringify(t.data || {}), now, becameCovered ? 1 : 0, now, t.coveredUrl || null, status, now, pid, key);
              result.updated++;
            }
            if (becameCovered && old) result.covered.push(key);
          }
        });
        return json(result);
      }
    }
    if (pid && parts[2] === "topics" && parts[3] && m === "PATCH") {
      const sets = [], args = [];
      if (body.status != null) {
        if (!STATUSES.has(body.status)) return json({ error: "Unknown status" }, 400);
        sets.push("status = ?", "status_changed_at = ?"); args.push(body.status, now);
      }
      if (body.notes != null) { sets.push("notes = ?"); args.push(String(body.notes).slice(0, 5000)); }
      if (body.section != null) { sets.push("section = ?"); args.push(String(body.section).slice(0, 20)); }
      if (!sets.length) return json({ error: "Nothing to change" }, 400);
      this.sql.exec(`UPDATE topics SET ${sets.join(", ")} WHERE project_id = ? AND key = ?`, ...args, pid, parts[3]);
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }
}

// Routes /api/cg/db/* to the caller's workspace database.
export async function handleDb(request, env) {
  const key = request.headers.get("X-Workspace-Key") || "";
  if (key.length < 16) return json({ error: "A workspace key of at least 16 characters is required" }, 401);
  if (!env.PROJECTS) return json({ error: "The PROJECTS database is not configured on this Worker" }, 500);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("searchverse-cg:" + key));
  const name = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return env.PROJECTS.get(env.PROJECTS.idFromName(name)).fetch(request);
}
