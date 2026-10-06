// Searchverse — Cloudflare Worker backend.
// Handles Google sign-in, multi-account Google connections (GSC + GA4),
// data pulls, a domain-restricted page fetcher for crawling, Gemini analysis, and storage in D1.

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const LOGIN_SCOPES = 'openid email profile';
const DATA_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
].join(' ');
const MAIL_SCOPES = 'openid email https://www.googleapis.com/auth/gmail.send';
const SESSION_DAYS = 30;
const DAY = 86400000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/auth/')) return await handleAuth(req, env, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return json({ error: e.message || String(e) }, status);
    }
  },
};

// ---------- helpers ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { location, ...headers } });
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(value, maxAge) {
  return `sid=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

const id = () => crypto.randomUUID().replace(/-/g, '');
const now = () => Date.now();

function b64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function decodeJwtPayload(jwt) {
  const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(new TextDecoder().decode(unb64(part + '='.repeat((4 - (part.length % 4)) % 4))));
}

async function aesKey(env) {
  if (!env.APP_SECRET) throw new HttpError(500, 'APP_SECRET is not configured');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.APP_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text));
  return b64(iv) + '.' + b64(ct);
}
async function decrypt(env, value) {
  const [iv, ct] = value.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

async function body(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

// ---------- auth ----------

const emailList = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const listMatch = (list, email) => list.some((a) => (a.startsWith('@') ? email.endsWith(a) : email === a));

// Decides whether an email may sign in and with which role. Returns null if not allowed.
//  - ADMIN_EMAILS (env) are always admins.
//  - Users an admin has added (users table) sign in with their stored role unless disabled.
//  - ALLOWED_EMAILS (env, optional) lets matching people self-join as members with no projects.
//  - If no admin exists yet and ADMIN_EMAILS is empty, the first person to sign in becomes admin.
async function signInRole(env, email) {
  if (listMatch(emailList(env.ADMIN_EMAILS), email)) return 'admin';
  const u = await env.DB.prepare('SELECT role, disabled FROM users WHERE email = ?').bind(email).first();
  if (u) return u.disabled ? null : u.role;
  if (listMatch(emailList(env.ALLOWED_EMAILS), email)) return 'member';
  if (!emailList(env.ADMIN_EMAILS).length) {
    const admin = await env.DB.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").first();
    if (!admin) return 'admin';
  }
  return null;
}

async function currentUser(req, env) {
  const sid = cookies(req).sid;
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT u.email, u.name, u.picture, u.gemini_key_enc, u.role FROM sessions s JOIN users u ON u.email = s.email
     WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`
  )
    .bind(sid, now())
    .first();
  return row || null;
}

async function requireUser(req, env) {
  const user = await currentUser(req, env);
  if (!user) throw new HttpError(401, 'Not signed in');
  return user;
}

function requireAdmin(user) {
  if (user.role !== 'admin') throw new HttpError(403, 'Only admins can do this');
}

async function handleAuth(req, env, url) {
  const redirectUri = url.origin + '/auth/callback';
  const path = url.pathname;

  if (path === '/auth/login' || path === '/auth/connect' || path === '/auth/connect-mail') {
    const mode = path === '/auth/login' ? 'login' : path === '/auth/connect-mail' ? 'mail' : 'connect';
    let email = null;
    if (mode !== 'login') {
      const user = await currentUser(req, env);
      if (!user) return redirect('/');
      if (user.role !== 'admin') return redirect('/#/?error=' + encodeURIComponent('Only admins can connect Google accounts'));
      email = user.email;
    }
    const state = id();
    await env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(now() - 3600000).run();
    await env.DB.prepare('INSERT INTO oauth_states (state, mode, email, created_at) VALUES (?, ?, ?, ?)')
      .bind(state, mode, email, now())
      .run();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: mode === 'login' ? LOGIN_SCOPES : mode === 'mail' ? MAIL_SCOPES : DATA_SCOPES,
      state,
      prompt: mode === 'login' ? 'select_account' : 'consent select_account',
    });
    if (mode !== 'login') params.set('access_type', 'offline');
    if (mode === 'mail' && !url.searchParams.get('hint')) params.set('login_hint', email);
    if (url.searchParams.get('hint')) params.set('login_hint', url.searchParams.get('hint'));
    return redirect(`${GOOGLE_AUTH}?${params}`);
  }

  if (path === '/auth/callback') {
    if (url.searchParams.get('error')) return redirect('/#/?error=' + encodeURIComponent(url.searchParams.get('error')));
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const st = await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first();
    if (!st || now() - st.created_at > 600000) return redirect('/#/?error=' + encodeURIComponent('Login expired, please try again'));
    await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();

    const tokRes = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tok = await tokRes.json();
    if (!tokRes.ok) return redirect('/#/?error=' + encodeURIComponent(tok.error_description || tok.error || 'Token exchange failed'));
    const profile = decodeJwtPayload(tok.id_token);
    const email = String(profile.email || '').toLowerCase();
    if (!email || profile.email_verified === false) return redirect('/#/?error=' + encodeURIComponent('Google account email not verified'));

    if (st.mode === 'login') {
      const role = await signInRole(env, email);
      if (!role) {
        return redirect('/#/?error=' + encodeURIComponent(`${email} doesn't have access yet. Ask your admin to add you.`));
      }
      await env.DB.prepare(
        `INSERT INTO users (email, name, picture, role, last_login, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name, picture = excluded.picture, role = excluded.role, last_login = excluded.last_login`
      )
        .bind(email, profile.name || email, profile.picture || '', role, now(), now())
        .run();
      const sid = id() + id();
      await env.DB.prepare('INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)')
        .bind(sid, email, now() + SESSION_DAYS * DAY)
        .run();
      return redirect('/#/', { 'set-cookie': sessionCookie(sid, SESSION_DAYS * 86400) });
    }

    // mail mode: store the admin's own mailbox (gmail.send) for sending invites
    if (st.mode === 'mail') {
      if (!(tok.scope || '').includes('gmail.send')) return redirect('/#/settings?error=' + encodeURIComponent('Please tick the "Send email on your behalf" permission on the Google screen.'));
      if (!tok.refresh_token) return redirect('/#/settings?error=' + encodeURIComponent('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.'));
      await env.DB.prepare(
        `INSERT OR REPLACE INTO mail_senders (owner_email, google_email, refresh_token_enc, access_token_enc, access_expires, connected_at, expired) VALUES (?, ?, ?, ?, ?, ?, 0)`
      ).bind(st.email, email, await encrypt(env, tok.refresh_token), await encrypt(env, tok.access_token), now() + (tok.expires_in || 3600) * 1000, now()).run();
      return redirect('/#/settings?mailconnected=' + encodeURIComponent(email));
    }

    // connect mode: store the refresh token for this Google account under the signed-in user
    const granted = tok.scope || '';
    if (!granted.includes('webmasters') && !granted.includes('analytics')) {
      return redirect('/#/settings?error=' + encodeURIComponent('Please tick the Search Console and Analytics permissions on the Google consent screen.'));
    }
    if (!tok.refresh_token) {
      return redirect(
        '/#/settings?error=' +
          encodeURIComponent('Google did not return a refresh token. Remove this app at myaccount.google.com/permissions for that account and connect again.')
      );
    }
    const enc = await encrypt(env, tok.refresh_token);
    const accEnc = await encrypt(env, tok.access_token);
    await env.DB.prepare(
      `INSERT INTO connections (id, owner_email, google_email, refresh_token_enc, access_token_enc, access_expires, scopes, created_at, connected_at, expired)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(owner_email, google_email) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc,
         access_token_enc = excluded.access_token_enc, access_expires = excluded.access_expires, scopes = excluded.scopes,
         connected_at = excluded.connected_at, expired = 0`
    )
      .bind(id(), st.email, email, enc, accEnc, now() + (tok.expires_in || 3600) * 1000, granted, now(), now())
      .run();
    return redirect('/#/settings?connected=' + encodeURIComponent(email));
  }

  if (path === '/auth/logout') {
    const sid = cookies(req).sid;
    if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    return redirect('/', { 'set-cookie': sessionCookie('', 0) });
  }

  throw new HttpError(404, 'Not found');
}

// ---------- google api ----------

async function accessToken(env, connectionId) {
  const c = await env.DB.prepare('SELECT * FROM connections WHERE id = ?').bind(connectionId).first();
  if (!c) throw new HttpError(400, 'The Google connection for this project was removed. Edit the project and pick another account.');
  if (c.access_token_enc && c.access_expires > now() + 60000) return decrypt(env, c.access_token_enc);
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: await decrypt(env, c.refresh_token_enc),
      grant_type: 'refresh_token',
    }),
  });
  const tok = await res.json();
  if (!res.ok) {
    if (tok.error === 'invalid_grant') await env.DB.prepare('UPDATE connections SET expired = 1 WHERE id = ?').bind(c.id).run();
    throw new HttpError(
      400,
      `Google access for ${c.google_email} has expired (Google limits testing-mode apps to 7 days). Go to Settings and click Reconnect.`
    );
  }
  await env.DB.prepare('UPDATE connections SET access_token_enc = ?, access_expires = ? WHERE id = ?')
    .bind(await encrypt(env, tok.access_token), now() + tok.expires_in * 1000, c.id)
    .run();
  return tok.access_token;
}

async function gfetch(token, url, payload) {
  const res = await fetch(url, {
    method: payload ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || res.statusText;
    throw new HttpError(res.status === 401 ? 400 : res.status, `Google API: ${msg}`);
  }
  return data;
}

// ---------- access control ----------

async function getProject(env, projectId, email) {
  const p = await env.DB.prepare(
    `SELECT p.*, CASE WHEN u.role = 'admin' THEN 'admin' ELSE m.role END AS my_role
     FROM projects p JOIN users u ON u.email = ?
     LEFT JOIN project_members m ON m.project_id = p.id AND m.email = u.email
     WHERE p.id = ? AND (u.role = 'admin' OR m.email IS NOT NULL)`
  )
    .bind(email, projectId)
    .first();
  if (!p) throw new HttpError(404, 'Project not found');
  return p;
}

async function getRun(env, runId, email) {
  const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  if (!run) throw new HttpError(404, 'Run not found');
  const project = await getProject(env, run.project_id, email);
  return { run, project };
}

const canRun = (project) => project.my_role === 'admin' || project.my_role === 'editor';
function requireRun(project) {
  if (!canRun(project)) throw new HttpError(403, 'You have view-only access to this project');
}

function hostAllowed(project, target) {
  const host = target.hostname.toLowerCase().replace(/^www\./, '');
  const base = new URL(project.site_url).hostname.toLowerCase().replace(/^www\./, '');
  if (host === base) return true;
  if (project.gsc_property.startsWith('sc-domain:')) {
    const d = project.gsc_property.slice(10).toLowerCase();
    return host === d || host.endsWith('.' + d);
  }
  return false;
}

// ---------- date ranges ----------

function ymd(d) {
  return d.toISOString().slice(0, 10);
}
// Custom range: compare with the previous period of equal length, or the same dates one year earlier.
function customPeriods(start, end, compare, pstart, pendIn) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(start) || !re.test(end) || start > end) throw new HttpError(400, 'Pick a valid start and end date');
  const s = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z');
  const oldest = new Date(now() - 486 * DAY);
  if (s < oldest) throw new HttpError(400, 'Search Console only keeps about 16 months of data');
  if (e > new Date(now() - DAY)) throw new HttpError(400, 'End date must be before today');
  const len = Math.round((e - s) / DAY) + 1;
  if (len > 366) throw new HttpError(400, 'Pick a range of at most 12 months');
  if (compare === 'custom') {
    if (!re.test(pstart || '') || !re.test(pendIn || '') || pstart > pendIn) throw new HttpError(400, 'Pick valid compare dates');
    if (new Date(pstart + 'T00:00:00Z') < oldest) throw new HttpError(400, 'Compare dates are older than Search Console keeps (~16 months)');
    return { start, end, pstart, pend: pendIn, compare: 'custom' };
  }
  if (compare === 'year') {
    const back = (d) => { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() - 1); return ymd(x); };
    return { start, end, pstart: back(s), pend: back(e), compare: 'year' };
  }
  const pend = new Date(s.getTime() - DAY);
  return { start, end, pstart: ymd(new Date(pend.getTime() - (len - 1) * DAY)), pend: ymd(pend), compare: 'previous' };
}

function periods(days = 28) {
  const end = new Date(now() - 3 * DAY); // GSC data lags ~2-3 days
  const start = new Date(end.getTime() - (days - 1) * DAY);
  const pend = new Date(start.getTime() - DAY);
  const pstart = new Date(pend.getTime() - (days - 1) * DAY);
  return { start: ymd(start), end: ymd(end), pstart: ymd(pstart), pend: ymd(pend) };
}

// ---------- API ----------

async function handleApi(req, env, url) {
  const path = url.pathname;
  const method = req.method;
  let m;

  if (path === '/api/me') {
    const user = await currentUser(req, env);
    if (!user) return json({ user: null });
    const conns = await env.DB.prepare('SELECT COUNT(*) AS n FROM connections').first();
    return json({
      user: { email: user.email, name: user.name, picture: user.picture, role: user.role, hasGeminiKey: !!user.gemini_key_enc },
      serverGeminiKey: !!env.GEMINI_API_KEY,
      mailEnabled: !!(env.BREVO_API_KEY && env.MAIL_FROM),
      mailSender: await env.DB.prepare('SELECT google_email, connected_at, expired FROM mail_senders WHERE owner_email = ?').bind(user.email).first().catch(() => null),
      connections: conns.n,
    });
  }

  const user = await requireUser(req, env);
  const DB = env.DB;

  // data retention: older runs keep summary + scores + AI report, bulky detail is removed
  if (path === '/api/retention' && method === 'GET') {
    return json({ days: await retentionDays(env) });
  }
  if (path === '/api/retention' && method === 'PUT') {
    requireAdmin(user);
    const b = await body(req);
    const days = Math.max(0, Math.min(3650, Number(b.days) || 0));
    await DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('retention_days', ?)").bind(String(days)).run();
    return json({ days, ...(await archiveOldRuns(env)) });
  }
  if (path === '/api/runs/delete' && method === 'POST') {
    requireAdmin(user);
    const ids = ((await body(req)).ids || []).map(String).slice(0, 200);
    await deleteRunData(env, ids);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50), q = chunk.map(() => '?').join(',');
      await DB.batch([DB.prepare(`DELETE FROM runs WHERE id IN (${q})`).bind(...chunk), DB.prepare(`DELETE FROM run_shard WHERE run_id IN (${q})`).bind(...chunk)]);
    }
    return json({ ok: true, deleted: ids.length });
  }
  if (path === '/api/retention/cleanup' && method === 'POST') {
    requireAdmin(user);
    return json(await archiveOldRuns(env));
  }

  // storage usage across all free storage databases (500 MB each)
  if (path === '/api/usage' && method === 'GET') {
    const list = shards(env);
    const sizes = await Promise.all(list.map((x) => shardSize(x.db).catch(() => 0)));
    const { results: runRows } = await DB.prepare(
      'SELECT id, project_id, COALESCE(LENGTH(summary_json),0)+COALESCE(LENGTH(gsc_json),0)+COALESCE(LENGTH(ga_json),0)+COALESCE(LENGTH(ai_json),0) AS b FROM runs'
    ).all();
    const runProject = Object.fromEntries(runRows.map((r) => [r.id, r.project_id]));
    const per = {};
    const bucket = (pid) => (per[pid] ||= { runs: 0, run: 0, pages: 0, exports: 0, pagesCount: 0 });
    for (const r of runRows) { const t = bucket(r.project_id); t.runs++; t.run += r.b; }
    let avgPage = null;
    for (const x of list) {
      const [pg, bl, av] = await Promise.all([
        x.db.prepare('SELECT run_id, SUM(LENGTH(data_json)) AS b, COUNT(*) AS n FROM pages GROUP BY run_id').all().then((r) => r.results).catch(() => []),
        x.db.prepare('SELECT run_id, SUM(LENGTH(data)) AS b FROM run_blobs GROUP BY run_id').all().then((r) => r.results).catch(() => []),
        x.db.prepare('SELECT AVG(LENGTH(data_json)) AS a FROM (SELECT data_json FROM pages ORDER BY rowid DESC LIMIT 500)').first().catch(() => null),
      ]);
      for (const r of pg) if (runProject[r.run_id]) { const t = bucket(runProject[r.run_id]); t.pages += r.b; t.pagesCount += r.n; }
      for (const r of bl) if (runProject[r.run_id]) bucket(runProject[r.run_id]).exports += r.b;
      if (av?.a) avgPage = avgPage ? (avgPage + av.a) / 2 : av.a;
    }
    const avgRun = runRows.length ? runRows.reduce((t, r) => t + r.b, 0) / runRows.length : 600000;
    let projects = [];
    if (user.role === 'admin') {
      const { results: names } = await DB.prepare('SELECT id, name FROM projects').all();
      projects = names.map((p) => ({ id: p.id, name: p.name, ...(per[p.id] || bucket(p.id)) }))
        .map((p) => ({ ...p, bytes: p.run + p.pages + p.exports })).sort((a, b) => b.bytes - a.bytes);
    }
    let runList = [];
    if (user.role === 'admin' && url.searchParams.get('runs')) {
      const perRun = {};
      for (const x of list) {
        const [pg, bl] = await Promise.all([
          x.db.prepare('SELECT run_id, SUM(LENGTH(data_json)) AS b, COUNT(*) AS n FROM pages GROUP BY run_id').all().then((r) => r.results).catch(() => []),
          x.db.prepare('SELECT run_id, SUM(LENGTH(data)) AS b FROM run_blobs GROUP BY run_id').all().then((r) => r.results).catch(() => []),
        ]);
        for (const r of pg) { const t = (perRun[r.run_id] ||= { b: 0, n: 0 }); t.b += r.b; t.n += r.n; }
        for (const r of bl) (perRun[r.run_id] ||= { b: 0, n: 0 }).b += r.b;
      }
      const { results: rr } = await DB.prepare(
        `SELECT r.id, r.project_id, p.name AS project, r.created_at, r.created_by, r.status, r.score, r.start_date, r.end_date, r.error,
           COALESCE(LENGTH(r.summary_json),0)+COALESCE(LENGTH(r.gsc_json),0)+COALESCE(LENGTH(r.ga_json),0)+COALESCE(LENGTH(r.ai_json),0) AS b, s.shard
         FROM runs r LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN run_shard s ON s.run_id = r.id ORDER BY r.created_at DESC`
      ).all();
      runList = rr.map((r) => ({ ...r, pages: perRun[r.id]?.n || 0, bytes: r.b + (perRun[r.id]?.b || 0), b: undefined }));
    }
    return json({
      runs: runList,
      dataBytes: Object.values(per).reduce((t, x) => t + x.run + x.pages + x.exports, 0),
      dbBytes: sizes.reduce((t, v) => t + v, 0), limitBytes: list.length * SHARD_LIMIT, exact: sizes.every(Boolean),
      databases: list.map((x, i) => ({ name: x.name, bytes: sizes[i], limit: SHARD_LIMIT })), maxDatabases: 10,
      avgPageBytes: Math.round(avgPage || 15000), avgRunBytes: Math.round(Math.max(avgRun, 100000)),
      exportBytesPerRow: 14, projects,
    });
  }

  // settings
  if (path === '/api/settings' && method === 'PUT') {
    const b = await body(req);
    if ('geminiKey' in b) {
      const enc = b.geminiKey ? await encrypt(env, b.geminiKey.trim()) : null;
      await DB.prepare('UPDATE users SET gemini_key_enc = ? WHERE email = ?').bind(enc, user.email).run();
    }
    return json({ ok: true });
  }

  // connections
  if (path.startsWith('/api/connections') || path.startsWith('/api/users')) requireAdmin(user);
  if (path === '/api/connections' && method === 'GET') {
    const { results } = await DB.prepare(
      'SELECT id, google_email, owner_email AS added_by, scopes, created_at, COALESCE(connected_at, created_at) AS connected_at, expired FROM connections ORDER BY created_at'
    ).all();
    return json({ connections: results });
  }
  if ((m = path.match(/^\/api\/connections\/(\w+)$/)) && method === 'DELETE') {
    await DB.prepare('DELETE FROM connections WHERE id = ?').bind(m[1]).run();
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/connections\/(\w+)\/properties$/))) {
    const c = await DB.prepare('SELECT id FROM connections WHERE id = ?').bind(m[1]).first();
    if (!c) throw new HttpError(404, 'Connection not found');
    const token = await accessToken(env, c.id);
    const [sites, ga] = await Promise.allSettled([
      gfetch(token, 'https://www.googleapis.com/webmasters/v3/sites'),
      gfetch(token, 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200'),
    ]);
    const gsc = sites.status === 'fulfilled'
      ? (sites.value.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser').map((s) => ({ url: s.siteUrl, permission: s.permissionLevel }))
      : [];
    const ga4 = [];
    if (ga.status === 'fulfilled') {
      for (const acc of ga.value.accountSummaries || []) {
        for (const p of acc.propertySummaries || []) ga4.push({ id: p.property, name: `${p.displayName} (${acc.displayName})` });
      }
    }
    return json({
      gsc: gsc.sort((a, b) => a.url.localeCompare(b.url)),
      ga4,
      errors: {
        gsc: sites.status === 'rejected' ? sites.reason.message : null,
        ga4: ga.status === 'rejected' ? ga.reason.message : null,
      },
    });
  }

  // projects
  if (path === '/api/projects' && method === 'GET') {
    const { results } = await DB.prepare(
      `SELECT p.id, p.name, p.site_url, p.gsc_property, p.ga4_property, p.ga4_name, p.owner_email, p.created_at,
        (SELECT score FROM runs r WHERE r.project_id = p.id AND r.status = 'done' ORDER BY created_at DESC LIMIT 1) AS last_score,
        (SELECT created_at FROM runs r WHERE r.project_id = p.id AND r.status = 'done' ORDER BY created_at DESC LIMIT 1) AS last_run,
        (SELECT json_extract(summary_json,'$.kpis') FROM runs r WHERE r.project_id = p.id AND r.status = 'done' ORDER BY created_at DESC LIMIT 1) AS last_kpis
        , CASE WHEN ? = 'admin' THEN 'admin' ELSE m.role END AS my_role
       FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.email = ?
       WHERE ? = 'admin' OR m.email IS NOT NULL ORDER BY p.created_at DESC`
    )
      .bind(user.role, user.email, user.role)
      .all();
    const { results: rr } = await DB.prepare(
      `SELECT id, project_id, created_at, created_by, score, start_date, end_date, error, json_extract(summary_json,'$.scope') AS scope
       FROM runs WHERE status = 'done' ORDER BY created_at DESC LIMIT 400`
    ).all();
    const recent = {};
    for (const r of rr) { const l = (recent[r.project_id] ||= []); if (l.length < 6) l.push(r); }
    return json({
      projects: results.map((p) => {
        p.recent_runs = recent[p.id] || [];
        const k = p.last_kpis ? JSON.parse(p.last_kpis) : null;
        delete p.last_kpis;
        return { ...p, kpis: k };
      }),
    });
  }
  if (path === '/api/projects' && method === 'POST') {
    requireAdmin(user);
    const b = await body(req);
    const p = await validateProject(env, user, b);
    const pid = id();
    await DB.prepare(
      `INSERT INTO projects (id, owner_email, name, site_url, gsc_property, ga4_property, ga4_name, connection_id, max_pages, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(pid, user.email, p.name, p.site_url, p.gsc_property, p.ga4_property, p.ga4_name, p.connection_id, p.max_pages, now())
      .run();
    await saveMeta(env, pid, p);
    return json({ id: pid });
  }
  if ((m = path.match(/^\/api\/projects\/(\w+)$/))) {
    const project = await getProject(env, m[1], user.email);
    if (method === 'GET') {
      const { results: members } = await DB.prepare('SELECT email, role FROM project_members WHERE project_id = ?').bind(project.id).all();
      const conn = project.connection_id
        ? await DB.prepare('SELECT google_email FROM connections WHERE id = ?').bind(project.connection_id).first()
        : null;
      const meta = await getMeta(env, project.id);
      return json({
        project: { ...project, members, connection_email: conn?.google_email || null, money_pages: meta.money_pages || '', brand_terms: meta.brand_terms || '', lead_event: meta.lead_event || '' },
      });
    }
    requireAdmin(user);
    if (method === 'PUT') {
      const p = await validateProject(env, user, await body(req));
      await DB.prepare(
        `UPDATE projects SET name = ?, site_url = ?, gsc_property = ?, ga4_property = ?, ga4_name = ?, connection_id = ?, max_pages = ? WHERE id = ?`
      )
        .bind(p.name, p.site_url, p.gsc_property, p.ga4_property, p.ga4_name, p.connection_id, p.max_pages, project.id)
        .run();
      await saveMeta(env, project.id, p);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const { results: rids } = await DB.prepare('SELECT id FROM runs WHERE project_id = ?').bind(project.id).all();
      await deleteRunData(env, rids.map((r) => r.id));
      await DB.batch([
        DB.prepare('DELETE FROM run_shard WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)').bind(project.id),
        DB.prepare('DELETE FROM runs WHERE project_id = ?').bind(project.id),
        DB.prepare('DELETE FROM project_members WHERE project_id = ?').bind(project.id),
        DB.prepare('DELETE FROM project_meta WHERE project_id = ?').bind(project.id),
        DB.prepare('DELETE FROM lob_groups WHERE project_id = ?').bind(project.id),
        DB.prepare('DELETE FROM lob_monthly WHERE project_id = ?').bind(project.id),
        DB.prepare('DELETE FROM ai_checks WHERE project_id = ?').bind(project.id),
        DB.prepare('DELETE FROM ai_prompts WHERE project_id = ?').bind(project.id),
        DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id),
      ]);
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/projects\/(\w+)\/members$/))) {
    const project = await getProject(env, m[1], user.email);
    requireAdmin(user);
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
    if (method === 'POST') {
      await ensureUser(env, email, user.email);
      await DB.prepare('INSERT OR REPLACE INTO project_members (project_id, email, role, added_at) VALUES (?, ?, ?, ?)')
        .bind(project.id, email, b.role === 'viewer' ? 'viewer' : 'editor', now())
        .run();
      return json({ ok: true, ...(await sendInvite(env, url.origin, email, user.email, project.name, b.role === 'viewer' ? 'viewer' : 'editor')) });
    } else if (method === 'DELETE') {
      await DB.prepare('DELETE FROM project_members WHERE project_id = ? AND email = ?').bind(project.id, email).run();
    }
    return json({ ok: true });
  }

  // users (admin only — guarded above)
  if (path === '/api/users' && method === 'GET') {
    const { results: users } = await DB.prepare(
      'SELECT email, name, picture, role, disabled, invited_by, last_login, created_at FROM users ORDER BY role, email'
    ).all();
    const { results: access } = await DB.prepare(
      'SELECT m.email, m.project_id, m.role, p.name FROM project_members m JOIN projects p ON p.id = m.project_id'
    ).all();
    return json({
      users: users.map((u) => ({ ...u, projects: access.filter((a) => a.email === u.email).map((a) => ({ id: a.project_id, name: a.name, role: a.role })) })),
    });
  }
  if (path === '/api/users' && method === 'POST') {
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
    const exists = await DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (exists) throw new HttpError(400, 'That user already exists — edit them instead');
    await DB.prepare('INSERT INTO users (email, name, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(email, email, b.role === 'admin' ? 'admin' : 'member', user.email, now())
      .run();
    await setAccess(env, email, b.projects);
    const firstProject = (b.projects || [])[0] ? await DB.prepare('SELECT name FROM projects WHERE id = ?').bind(String(b.projects[0].id)).first() : null;
    return json({ ok: true, ...(await sendInvite(env, url.origin, email, user.email, (b.projects || []).length === 1 ? firstProject?.name : null, b.role === 'admin' ? 'admin' : 'editor')) });
  }
  // (re)send an invite; returns the text so the browser can fall back to the user's own mail app
  if (path === '/api/invite' && method === 'POST') {
    requireAdmin(user);
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
    const proj = b.projectId ? await DB.prepare('SELECT name FROM projects WHERE id = ?').bind(String(b.projectId)).first() : null;
    const role = b.role || 'editor';
    const sent = b.manualOnly ? { emailed: false, reason: 'manual' } : await sendInvite(env, url.origin, email, user.email, proj?.name, role);
    return json({ ...sent, ...inviteText(url.origin, user.email, proj?.name, role), to: email });
  }
  if ((m = path.match(/^\/api\/users\/([^/]+)$/))) {
    const email = decodeURIComponent(m[1]).toLowerCase();
    const target = await DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!target) throw new HttpError(404, 'User not found');
    const otherAdmins = await DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND email != ?").bind(email).first();
    if (method === 'PUT') {
      const b = await body(req);
      const role = b.role === 'admin' ? 'admin' : 'member';
      const disabled = b.disabled ? 1 : 0;
      if (target.role === 'admin' && (role !== 'admin' || disabled) && !otherAdmins.n) throw new HttpError(400, 'There must be at least one active admin');
      await DB.prepare('UPDATE users SET role = ?, disabled = ? WHERE email = ?').bind(role, disabled, email).run();
      if (disabled) await DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run();
      if (Array.isArray(b.projects)) await setAccess(env, email, b.projects);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      if (email === user.email) throw new HttpError(400, "You can't remove yourself");
      if (target.role === 'admin' && !otherAdmins.n) throw new HttpError(400, 'There must be at least one active admin');
      await DB.batch([
        DB.prepare('DELETE FROM project_members WHERE email = ?').bind(email),
        DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email),
        DB.prepare('DELETE FROM users WHERE email = ?').bind(email),
      ]);
      return json({ ok: true });
    }
  }

  // LOB report: URL groups + monthly GSC numbers
  if ((m = path.match(/^\/api\/projects\/(\w+)\/lobs$/))) {
    const project = await getProject(env, m[1], user.email);
    if (method === 'GET') {
      const year = String(url.searchParams.get('year') || new Date().getUTCFullYear());
      const { results: groups } = await DB.prepare('SELECT id, name, category, patterns, sort FROM lob_groups WHERE project_id = ? ORDER BY sort')
        .bind(project.id)
        .all();
      const { results: rows } = await DB.prepare(
        'SELECT group_id, month, clicks, impressions, ctr, position, days, updated_at FROM lob_monthly WHERE project_id = ? AND month LIKE ?'
      )
        .bind(project.id, year + '-%')
        .all();
      const { results: ga } = await DB.prepare('SELECT * FROM lob_ga WHERE project_id = ? AND period LIKE ?').bind(project.id, year + '-%').all();
      return json({ groups, rows, ga, hasGa: !!project.ga4_property, canRun: canRun(project), isAdmin: user.role === 'admin' });
    }
    if (method === 'PUT') {
      requireAdmin(user);
      const b = await body(req);
      const groups = (b.groups || []).slice(0, 40).map((g, i) => ({
        id: /^\w{8,40}$/.test(g.id || '') ? g.id : id(),
        name: String(g.name || '').trim().slice(0, 120),
        category: String(g.category || '').trim().slice(0, 60),
        patterns: String(g.patterns || '').trim().slice(0, 4000),
        sort: i,
      }));
      for (const g of groups) {
        if (!g.name || !g.patterns) throw new HttpError(400, 'Every group needs a name and at least one page path');
        lobRegex(g.patterns);
      }
      const keep = groups.map((g) => g.id);
      const stmts = [DB.prepare('DELETE FROM lob_groups WHERE project_id = ?').bind(project.id)];
      for (const g of groups) {
        stmts.push(
          DB.prepare('INSERT INTO lob_groups (id, project_id, name, category, patterns, sort) VALUES (?, ?, ?, ?, ?, ?)').bind(
            g.id, project.id, g.name, g.category, g.patterns, g.sort
          )
        );
      }
      // drop stored numbers of removed groups
      stmts.push(
        DB.prepare(
          `DELETE FROM lob_monthly WHERE project_id = ? AND group_id != '__site__' AND group_id NOT IN (${keep.map(() => '?').join(',') || "''"})`
        ).bind(project.id, ...keep)
      );
      await DB.batch(stmts);
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/projects\/(\w+)\/lobs\/refresh$/)) && method === 'POST') {
    const project = await getProject(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    const year = Number(b.year) || new Date().getUTCFullYear();
    const { results: allGroups } = await DB.prepare('SELECT id, patterns FROM lob_groups WHERE project_id = ? ORDER BY sort').bind(project.id).all();
    // the browser refreshes groups in small batches to stay inside Worker request limits
    const ids = Array.isArray(b.groupIds) ? b.groupIds : null;
    const groups = ids ? allGroups.filter((g) => ids.includes(g.id)) : allGroups;
    const start = `${year}-01-01`;
    const lastAvail = ymd(new Date(now() - 3 * DAY));
    const end = `${year}-12-31` < lastAvail ? `${year}-12-31` : lastAvail;
    if (start > end) throw new HttpError(400, 'No Search Console data for that year yet');
    const token = await accessToken(env, project.connection_id);
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(project.gsc_property)}/searchAnalytics/query`;
    const fetchGroup = async (g) => {
      const filters = g ? lobFilters(g.patterns) : [];
      const res = await gfetch(token, endpoint, {
        startDate: start,
        endDate: end,
        dimensions: ['date'],
        type: 'web',
        rowLimit: 400,
        ...(filters.length ? { dimensionFilterGroups: [{ groupType: 'and', filters }] } : {}),
      });
      const months = {};
      for (const r of res.rows || []) {
        for (const key of [r.keys[0].slice(0, 7), isoWeek(r.keys[0])]) {
          const t = (months[key] ||= { c: 0, i: 0, pw: 0, d: 0 });
          t.c += r.clicks;
          t.i += r.impressions;
          t.pw += r.position * r.impressions;
          t.d++;
        }
      }
      return { id: g ? g.id : '__site__', months };
    };
    const gaEndpoint = project.ga4_property ? `https://analyticsdata.googleapis.com/v1beta/${project.ga4_property}:runReport` : null;
    const meta = await getMeta(env, project.id);
    const fetchGa = async (g) => {
      const res = await gfetch(token, gaEndpoint, {
        dateRanges: [{ startDate: start, endDate: end }],
        dimensions: [{ name: 'date' }],
        metrics: gaMetrics(meta.lead_event).map((name) => ({ name })),
        dimensionFilter: gaFilter(true, g ? g.patterns : null),
        limit: 400,
      });
      const out = {};
      for (const r of res.rows || []) {
        const d = r.dimensionValues[0].value;
        const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
        const v = r.metricValues.map((x) => Number(x.value || 0));
        for (const key of [day.slice(0, 7), isoWeek(day)]) {
          const t = (out[key] ||= { s: 0, nu: 0, tu: 0, pv: 0, ke: 0, ld: 0, bs: 0, d: 0 });
          t.s += v[0]; t.nu += v[1]; t.tu += v[2]; t.bs += v[3] * v[0]; t.pv += v[4]; t.ke += v[5]; t.ld += v[6] || 0; t.d++;
        }
      }
      return { id: g ? g.id : '__site__', out };
    };
    const targets = [...groups, ...(b.includeSite !== false ? [null] : [])];
    const [results, gaResults] = await Promise.all([
      Promise.all(targets.map(fetchGroup)),
      gaEndpoint ? Promise.all(targets.map((g) => fetchGa(g).catch(() => null))) : [],
    ]);
    const stmts = [];
    for (const r of results) {
      for (const [mo, t] of Object.entries(r.months)) {
        stmts.push(
          DB.prepare(
            `INSERT INTO lob_monthly (project_id, group_id, month, clicks, impressions, ctr, position, days, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id, group_id, month) DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions,
               ctr = excluded.ctr, position = excluded.position, days = excluded.days, updated_at = excluded.updated_at`
          ).bind(project.id, r.id, mo, t.c, t.i, t.i ? t.c / t.i : 0, t.i ? t.pw / t.i : 0, t.d, now())
        );
      }
    }
    for (const r of gaResults.filter(Boolean)) {
      for (const [k, t] of Object.entries(r.out)) {
        stmts.push(
          DB.prepare(
            `INSERT OR REPLACE INTO lob_ga (project_id, group_id, period, sessions, new_users, total_users, views, key_events, leads, bounce_sessions, days, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(project.id, r.id, k, t.s, t.nu, t.tu, t.pv, t.ke, t.ld, t.bs, t.d, now())
        );
      }
    }
    for (let i = 0; i < stmts.length; i += 400) await DB.batch(stmts.slice(i, i + 400));
    return json({ ok: true, updated: results.length, range: [start, end] });
  }

  // AI answer visibility: track prompts in Gemini + Google Search grounding (free Gemini key)
  if ((m = path.match(/^\/api\/projects\/(\w+)\/ai-prompts$/))) {
    const project = await getProject(env, m[1], user.email);
    if (method === 'GET') {
      const [{ results: prompts }, { results: checks }] = await Promise.all([
        DB.prepare('SELECT id, prompt, created_at FROM ai_prompts WHERE project_id = ? ORDER BY created_at').bind(project.id).all(),
        DB.prepare('SELECT id, prompt_id, run_at, engine, model, answer, search_queries, sources, mentioned, cited, error FROM ai_checks WHERE project_id = ? ORDER BY run_at DESC LIMIT 500').bind(project.id).all(),
      ]);
      return json({ prompts, checks: checks.map((c) => ({ ...c, sources: JSON.parse(c.sources || '[]'), search_queries: JSON.parse(c.search_queries || '[]') })), canRun: canRun(project) });
    }
    requireRun(project);
    const b = await body(req);
    if (method === 'POST') {
      const list = String(b.prompts || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 50);
      const { results: have } = await DB.prepare('SELECT COUNT(*) AS n FROM ai_prompts WHERE project_id = ?').bind(project.id).all();
      if (have[0].n + list.length > 100) throw new HttpError(400, 'Up to 100 prompts per project');
      if (list.length) await DB.batch(list.map((pr) => DB.prepare('INSERT INTO ai_prompts (id, project_id, prompt, created_at) VALUES (?, ?, ?, ?)').bind(id(), project.id, pr.slice(0, 500), now())));
      return json({ ok: true, added: list.length });
    }
    if (method === 'DELETE') {
      await DB.batch([
        DB.prepare('DELETE FROM ai_checks WHERE prompt_id = ? AND project_id = ?').bind(String(b.id), project.id),
        DB.prepare('DELETE FROM ai_prompts WHERE id = ? AND project_id = ?').bind(String(b.id), project.id),
      ]);
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/projects\/(\w+)\/ai-prompts\/check$/)) && method === 'POST') {
    const project = await getProject(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    const key = user.gemini_key_enc ? await decrypt(env, user.gemini_key_enc) : env.GEMINI_API_KEY;
    if (!key) throw new HttpError(400, 'Add your free Gemini key in Settings first');
    const ids = (b.ids || []).slice(0, 3); // a few per request; the browser loops
    const { results: prompts } = await DB.prepare(`SELECT id, prompt FROM ai_prompts WHERE project_id = ? AND id IN (${ids.map(() => '?').join(',') || "''"})`).bind(project.id, ...ids).all();
    const meta = await getMeta(env, project.id);
    const out = [];
    for (const pr of prompts) {
      const r = await checkPrompt(env, key, project, meta, pr.prompt);
      const cid = id();
      await DB.prepare(
        'INSERT INTO ai_checks (id, prompt_id, project_id, run_at, engine, model, answer, search_queries, sources, mentioned, cited, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(cid, pr.id, project.id, now(), r.engine, r.model, r.answer, JSON.stringify(r.queries), JSON.stringify(r.sources), r.mentioned ? 1 : 0, r.cited ? 1 : 0, r.error || null).run();
      out.push({ prompt_id: pr.id, ...r });
    }
    return json({ results: out });
  }

  // runs
  if ((m = path.match(/^\/api\/projects\/(\w+)\/runs$/))) {
    const project = await getProject(env, m[1], user.email);
    if (method === 'GET') {
      const { results } = await DB.prepare(
        `SELECT id, created_at, created_by, status, start_date, end_date, score, error,
           json_extract(summary_json,'$.kpis') AS kpis, json_extract(summary_json,'$.scores') AS scores,
           json_extract(summary_json,'$.scope') AS scope, json_extract(summary_json,'$.compare') AS compare
         FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`
      )
        .bind(project.id)
        .all();
      return json({
        runs: results.map((r) => {
          const pj = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
          return { ...r, kpis: pj(r.kpis), scores: pj(r.scores) };
        }),
      });
    }
    if (method === 'POST') {
      requireRun(project);
      if (!project.connection_id) throw new HttpError(400, 'This project has no Google account connected');
      const b = await body(req).catch(() => ({}));
      const pr = b.start && b.end
        ? customPeriods(String(b.start), String(b.end), b.compare, b.pstart && String(b.pstart), b.pend && String(b.pend))
        : periods([7, 28, 90].includes(Number(b.days)) ? Number(b.days) : 28);
      const rid = id();
      await DB.prepare(
        `INSERT INTO runs (id, project_id, created_by, created_at, status, start_date, end_date, prev_start, prev_end)
         VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`
      )
        .bind(rid, project.id, user.email, now(), pr.start, pr.end, pr.pstart, pr.pend)
        .run();
      await dataDb(env, rid, true);
      return json({ run: { id: rid, ...pr } });
    }
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)$/))) {
    const { run, project } = await getRun(env, m[1], user.email);
    if (method === 'GET') {
      const { results: pages } = await (await dataDb(env, run.id)).prepare('SELECT url, onpage_score, content_score, data_json FROM pages WHERE run_id = ?')
        .bind(run.id)
        .all();
      // Big runs hold megabytes of JSON; parsing it here would blow the free plan's CPU limit,
      // so the stored JSON strings are spliced into the response as-is and parsed in the browser.
      const { summary_json, gsc_json, ga_json, ai_json, ...meta } = run;
      const raw = (v) => (v && v.trim() ? v : 'null');
      const pagesJson = '[' + pages.map((p) => `{"url":${JSON.stringify(p.url)},"onpage_score":${Number(p.onpage_score) || 0},"content_score":${Number(p.content_score) || 0},"data":${raw(p.data_json)}}`).join(',') + ']';
      const out = `{"run":${JSON.stringify(meta).slice(0, -1)},"summary":${raw(summary_json)},"gsc":${raw(gsc_json)},"ga":${raw(ga_json)},"ai":${raw(ai_json)}},"pages":${pagesJson},"project":${JSON.stringify({ id: project.id, name: project.name, site_url: project.site_url })},"packed":1}`;
      return new Response(out, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (method === 'DELETE') {
      requireAdmin(user);
      await deleteRunData(env, [run.id]);
      await DB.batch([DB.prepare('DELETE FROM runs WHERE id = ?').bind(run.id), DB.prepare('DELETE FROM run_shard WHERE run_id = ?').bind(run.id)]);
      return json({ ok: true });
    }
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)\/gsc$/)) && method === 'POST') {
    const { run, project } = await getRun(env, m[1], user.email);
    requireRun(project);
    const token = await accessToken(env, project.connection_id);
    const gsc = await pullGsc(token, project, run);
    await DB.prepare('UPDATE runs SET gsc_json = ? WHERE id = ?').bind(JSON.stringify(gsc), run.id).run();
    return json({ gsc });
  }

  // Live rows for the URL performance view (any project member may view).
  if ((m = path.match(/^\/api\/projects\/(\w+)\/gsc-rows$/)) && method === 'POST') {
    const project = await getProject(env, m[1], user.email);
    const b = await body(req);
    const filters = [];
    if (b.page) filters.push({ dimension: 'page', operator: 'equals', expression: String(b.page) });
    if (Array.isArray(b.groupIds) && b.groupIds.length) {
      const { results } = await DB.prepare('SELECT id, patterns FROM lob_groups WHERE project_id = ?').bind(project.id).all();
      const inc = results.filter((g) => b.groupIds.includes(g.id)).flatMap((g) => lobRules(g.patterns).inc);
      if (inc.length) filters.push({ dimension: 'page', operator: 'includingRegex', expression: inc.map((r) => `(${r})`).join('|') });
    }
    return gscPassthrough(env, project, b, filters);
  }
  if ((m = path.match(/^\/api\/projects\/(\w+)\/ga-rows$/)) && method === 'POST') {
    const project = await getProject(env, m[1], user.email);
    if (!project.ga4_property) return json({ rows: [] });
    const b = await body(req);
    let patterns = null;
    if (Array.isArray(b.groupIds) && b.groupIds.length) {
      const { results } = await DB.prepare('SELECT id, patterns FROM lob_groups WHERE project_id = ?').bind(project.id).all();
      patterns = results.filter((g) => b.groupIds.includes(g.id)).map((g) => g.patterns).join('\n') || null;
    }
    const meta = await getMeta(env, project.id);
    const token = await accessToken(env, project.connection_id);
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${project.ga4_property}:runReport`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: String(b.startDate), endDate: String(b.endDate) }],
        dimensions: [{ name: 'landingPage' }],
        metrics: gaMetrics(meta.lead_event).map((name) => ({ name })),
        dimensionFilter: gaFilter(true, patterns), // always Organic Search only
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: Math.min(25000, Number(b.limit) || 10000),
        offset: Math.max(0, Number(b.offset) || 0),
      }),
    });
    return new Response(res.body, { status: res.ok ? 200 : 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }

  // Full Search Console export: the browser pages through results (25k rows per call);
  // the Worker only forwards the request so it stays within free-plan CPU limits.
  if ((m = path.match(/^\/api\/runs\/(\w+)\/gsc-rows$/)) && method === 'POST') {
    const { project } = await getRun(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    return gscPassthrough(env, project, b, []);
  }
  if ((m = path.match(/^\/api\/runs\/(\w+)\/blob$/))) {
    const { run, project } = await getRun(env, m[1], user.email);
    const kind = String(url.searchParams.get('kind') || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (!kind) throw new HttpError(400, 'kind required');
    if (method === 'POST') {
      requireRun(project);
      const chunk = Math.max(0, Math.min(500, Number(url.searchParams.get('chunk')) || 0));
      const text = await req.text();
      if (text.length > 1_800_000) throw new HttpError(413, 'Chunk too large');
      await (await dataDb(env, run.id, true)).prepare('INSERT OR REPLACE INTO run_blobs (run_id, kind, chunk, data) VALUES (?, ?, ?, ?)').bind(run.id, kind, chunk, text).run();
      return json({ ok: true });
    }
    const { results } = await (await dataDb(env, run.id)).prepare('SELECT data FROM run_blobs WHERE run_id = ? AND kind = ? ORDER BY chunk').bind(run.id, kind).all();
    if (!results.length) throw new HttpError(404, 'Not stored for this run');
    if (results[0].data.startsWith('gz:')) return json({ gz: results.map((r) => r.data.slice(3)) });
    // older uncompressed chunks are JSON arrays; join them into one array without parsing
    const parts = results.map((r) => r.data.trim().replace(/^\[|\]$/g, '')).filter(Boolean);
    return new Response('[' + parts.join(',') + ']', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)\/ga$/)) && method === 'POST') {
    const { run, project } = await getRun(env, m[1], user.email);
    requireRun(project);
    if (!project.ga4_property) return json({ ga: null });
    const token = await accessToken(env, project.connection_id);
    const ga = await pullGa(token, project, run);
    await DB.prepare('UPDATE runs SET ga_json = ? WHERE id = ?').bind(JSON.stringify(ga), run.id).run();
    return json({ ga });
  }

  if ((m = path.match(/^\/api\/projects\/(\w+)\/fetch$/))) {
    const project = await getProject(env, m[1], user.email);
    requireRun(project);
    return json(await fetchPage(project, url.searchParams.get('url')));
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)\/pages$/)) && method === 'POST') {
    const { run, project } = await getRun(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    const D = await dataDb(env, run.id, true);
    const stmts = (b.pages || []).slice(0, 50).map((p) => {
      const { url: pageUrl, onpage_score, content_score, ...rest } = p;
      return D.prepare('INSERT OR REPLACE INTO pages (run_id, url, onpage_score, content_score, data_json) VALUES (?, ?, ?, ?, ?)').bind(
        run.id,
        String(pageUrl),
        Math.round(onpage_score) || 0,
        Math.round(content_score) || 0,
        JSON.stringify(rest)
      );
    });
    if (stmts.length) await D.batch(stmts);
    return json({ ok: true, saved: stmts.length });
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)\/finish$/)) && method === 'POST') {
    const { run, project } = await getRun(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    await DB.prepare('UPDATE runs SET status = ?, score = ?, summary_json = ?, error = ? WHERE id = ?')
      .bind(b.error ? 'error' : 'done', Math.round(b.score) || 0, JSON.stringify(b.summary || {}), b.error || null, run.id)
      .run();
    await archiveOldRuns(env).catch(() => {});
    return json({ ok: true });
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)\/ai$/)) && method === 'POST') {
    const { run, project } = await getRun(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    const key = user.gemini_key_enc ? await decrypt(env, user.gemini_key_enc) : env.GEMINI_API_KEY;
    if (!key && !env.AI) throw new HttpError(400, 'No Gemini API key. Add your free key in Settings (aistudio.google.com/apikey).');
    const ignored = JSON.parse((await getMeta(env, project.id)).ai_ignored || '[]');
    const ai = await askAI(env, key, { ...project, ignored }, b.input);
    ai.generated_at = now();
    await DB.prepare('UPDATE runs SET ai_json = ? WHERE id = ?').bind(JSON.stringify(ai), run.id).run();
    return json({ ai });
  }

  // mark an AI bullet as not relevant: hide it on this run and teach future analyses to skip it
  if ((m = path.match(/^\/api\/runs\/(\w+)\/ai-ignore$/)) && method === 'POST') {
    const { run, project } = await getRun(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    const row = await DB.prepare('SELECT ai_json FROM runs WHERE id = ?').bind(run.id).first();
    const ai = row?.ai_json ? JSON.parse(row.ai_json) : null;
    const list = ai?.[b.sec];
    if (!Array.isArray(list)) throw new HttpError(400, 'Nothing to change');
    ai.hidden ||= [];
    let point = '';
    if (b.restore) {
      const h = ai.hidden.findIndex((x) => x.sec === b.sec && x.item?.point === b.point);
      if (h < 0) throw new HttpError(404, 'Not found');
      list.push(ai.hidden[h].item);
      point = ai.hidden[h].item.point;
      ai.hidden.splice(h, 1);
    } else {
      const it = list[+b.i];
      if (!it) throw new HttpError(404, 'Not found');
      list.splice(+b.i, 1);
      ai.hidden.push({ sec: b.sec, item: it, by: user.email });
      point = it.point || it.title || '';
    }
    const meta = await getMeta(env, project.id);
    let ign = JSON.parse(meta.ai_ignored || '[]').filter((x) => x !== point);
    if (!b.restore && point) ign = [point, ...ign].slice(0, 40);
    await DB.batch([
      DB.prepare('UPDATE runs SET ai_json = ? WHERE id = ?').bind(JSON.stringify(ai), run.id),
      DB.prepare('INSERT OR REPLACE INTO project_meta (project_id, key, value) VALUES (?, ?, ?)').bind(project.id, 'ai_ignored', JSON.stringify(ign)),
    ]);
    return json({ ai });
  }

  throw new HttpError(404, 'Not found');
}

// LOB page-path rules, one per line (or comma separated):
//   /blog/broadband/         URL contains this text (default)
//   https://site.com/page    exact URL
//   regex:^.*/plans/.*$      raw RE2 regex
//   !something               exclude URLs containing this (can combine with any of the above)
function lobRules(patterns) {
  const inc = [];
  const exc = [];
  for (let raw of String(patterns).split(/[\n,]+/)) {
    raw = raw.trim();
    if (!raw) continue;
    const neg = raw.startsWith('!');
    if (neg) raw = raw.slice(1).trim();
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = raw.startsWith('regex:') ? raw.slice(6).trim() : /^https?:\/\//i.test(raw) ? '^' + esc(raw) + '$' : esc(raw);
    (neg ? exc : inc).push(re);
  }
  return { inc, exc };
}
function lobRegex(patterns) {
  const { inc } = lobRules(patterns);
  if (!inc.length) throw new HttpError(400, 'Each group needs at least one page path to include');
  for (const r of inc) {
    try {
      new RegExp(r);
    } catch {
      throw new HttpError(400, `Invalid regex: ${r}`);
    }
  }
}
function lobFilters(patterns) {
  const { inc, exc } = lobRules(patterns);
  const f = [{ dimension: 'page', operator: 'includingRegex', expression: inc.map((r) => `(${r})`).join('|') }];
  if (exc.length) f.push({ dimension: 'page', operator: 'excludingRegex', expression: exc.map((r) => `(${r})`).join('|') });
  return f;
}

async function gscPassthrough(env, project, b, filters) {
  const dims = (b.dimensions || []).filter((d) => ['query', 'page', 'date', 'device', 'country'].includes(d));
  const token = await accessToken(env, project.connection_id);
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(project.gsc_property)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      startDate: String(b.startDate),
      endDate: String(b.endDate),
      dimensions: dims,
      type: 'web',
      rowLimit: Math.min(25000, Number(b.rowLimit) || 25000),
      startRow: Math.max(0, Number(b.startRow) || 0),
      ...(filters.length ? { dimensionFilterGroups: [{ groupType: 'and', filters }] } : {}),
    }),
  });
  return new Response(res.body, { status: res.ok ? 200 : 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// ISO week key like 2026-W41 for a YYYY-MM-DD date
function isoWeek(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const week = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// GA4 metrics, in a fixed order the browser relies on
function gaMetrics(leadEvent) {
  const list = ['sessions', 'newUsers', 'totalUsers', 'bounceRate', 'screenPageViews', 'keyEvents'];
  if (leadEvent) list.push(`keyEvents:${leadEvent}`);
  return list;
}

// GA4 filter: organic channel and/or LOB landing-page rules (paths, since GA has no host in landingPage)
function gaFilter(organicOnly, patterns) {
  const exprs = [];
  if (organicOnly) exprs.push({ filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } } });
  if (patterns) {
    const inc = [];
    const exc = [];
    for (let raw of String(patterns).split(/[\n,]+/)) {
      raw = raw.trim();
      if (!raw) continue;
      const neg = raw.startsWith('!');
      if (neg) raw = raw.slice(1).trim();
      const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let re;
      if (raw.startsWith('regex:')) re = raw.slice(6).trim().replace(/^\^?https?:(\\)?\/(\\)?\/[^/]+/, '^');
      else if (/^https?:\/\//i.test(raw)) {
        try {
          re = '^' + esc(new URL(raw).pathname) + '$';
        } catch {
          continue;
        }
      } else re = esc(raw);
      (neg ? exc : inc).push(re);
    }
    if (inc.length) exprs.push({ filter: { fieldName: 'landingPage', stringFilter: { matchType: 'PARTIAL_REGEXP', value: inc.map((r) => `(${r})`).join('|') } } });
    if (exc.length) exprs.push({ notExpression: { filter: { fieldName: 'landingPage', stringFilter: { matchType: 'PARTIAL_REGEXP', value: exc.map((r) => `(${r})`).join('|') } } } });
  }
  if (!exprs.length) return undefined;
  return exprs.length === 1 ? exprs[0] : { andGroup: { expressions: exprs } };
}

// ---------- invite emails (Brevo free plan: 300 emails/day, no card) ----------
function inviteText(origin, inviter, projectName, role) {
  const where = projectName ? `the "${projectName}" project` : 'Searchverse';
  const can = role === 'admin' ? 'full admin access' : role === 'viewer' ? 'view-only access' : 'permission to view and run analyses';
  return {
    subject: `${inviter} invited you to Searchverse${projectName ? ` — ${projectName}` : ''}`,
    text: `Hi,\n\n${inviter} has invited you to ${where} in Searchverse (GA & GSC SEO insights), with ${can}.\n\nHow to open it:\n1. Go to ${origin}\n2. Click "Sign in with Google"\n3. Choose this email address\n\nIf Google says "app not verified", click Continue — it's your team's internal tool.\n\nThanks`,
  };
}
// Send from the inviting admin's own Gmail / Workspace mailbox (Gmail API, gmail.send scope).
async function sendViaGmail(env, inviter, to, t, html) {
  const ms = await env.DB.prepare('SELECT * FROM mail_senders WHERE owner_email = ? AND expired = 0').bind(inviter).first();
  if (!ms) return null;
  let token;
  if (ms.access_token_enc && ms.access_expires > now() + 60000) token = await decrypt(env, ms.access_token_enc);
  else {
    const r = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: await decrypt(env, ms.refresh_token_enc), grant_type: 'refresh_token' }),
    });
    const tk = await r.json();
    if (!r.ok) {
      if (tk.error === 'invalid_grant') await env.DB.prepare('UPDATE mail_senders SET expired = 1 WHERE owner_email = ?').bind(inviter).run();
      return { emailed: false, reason: 'Your mailbox connection expired — reconnect it in Settings' };
    }
    token = tk.access_token;
    await env.DB.prepare('UPDATE mail_senders SET access_token_enc = ?, access_expires = ? WHERE owner_email = ?').bind(await encrypt(env, token), now() + tk.expires_in * 1000, inviter).run();
  }
  const b64 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (const x of bytes) bin += String.fromCharCode(x); return btoa(bin); };
  const boundary = 'sv' + id();
  const mime = [
    `From: ${ms.google_email}`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(t.subject)}?=`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(t.text),
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(html),
    `--${boundary}--`,
  ].join('\r\n');
  const raw = b64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (res.ok) return { emailed: true, via: 'gmail', from: ms.google_email };
  const err = await res.json().catch(() => ({}));
  return { emailed: false, reason: 'Gmail: ' + (err.error?.message || res.statusText) };
}

async function sendInvite(env, origin, to, inviter, projectName, role) {
  const t = inviteText(origin, inviter, projectName, role);
  const html0 = t.text.split('\n').map((l) => (l ? l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(origin, `<a href="${origin}">${origin}</a>`) : '')).join('<br>');
  const viaGmail = await sendViaGmail(env, inviter, to, t, html0).catch((e) => ({ emailed: false, reason: e.message }));
  if (viaGmail?.emailed) return viaGmail;
  if (!env.BREVO_API_KEY || !env.MAIL_FROM) return viaGmail || { emailed: false, reason: 'not_configured' };
  const html = t.text.split('\n').map((l) => (l ? l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(origin, `<a href="${origin}">${origin}</a>`) : '<br>')).join('<br>');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || 'Searchverse' }, to: [{ email: to }], replyTo: { email: inviter }, subject: t.subject, textContent: t.text, htmlContent: html }),
  }).catch((e) => ({ ok: false, statusText: e.message }));
  if (res.ok) return { emailed: true };
  const err = await res.json?.().catch(() => ({}));
  return { emailed: false, reason: err?.message || res.statusText || 'send_failed' };
}

// ---------- storage shards ----------
// The free plan allows 10 databases of 500 MB each. Run metadata stays in DB; the bulky per-run data
// (crawled pages + exports) goes to whichever storage database has the most room: DB itself or DATA1..DATA9.
const SHARD_LIMIT = 500 * 1024 * 1024;
function shards(env) {
  const list = [{ name: 'main', db: env.DB }];
  for (let i = 1; i <= 9; i++) if (env['DATA' + i]) list.push({ name: 'DATA' + i, db: env['DATA' + i] });
  return list;
}
async function shardSize(db) {
  const r = await db.prepare('SELECT 1').run();
  return r.meta?.size_after || 0;
}
async function dataDb(env, runId, assign = false) {
  const list = shards(env);
  const row = await env.DB.prepare('SELECT shard FROM run_shard WHERE run_id = ?').bind(runId).first();
  if (row) return (list.find((x) => x.name === row.shard) || list[0]).db;
  if (!assign || list.length === 1) return env.DB;
  const sizes = await Promise.all(list.map((x) => shardSize(x.db).catch(() => Infinity)));
  let best = 0;
  sizes.forEach((v, i) => { if (v < sizes[best]) best = i; });
  await env.DB.prepare('INSERT OR IGNORE INTO run_shard (run_id, shard) VALUES (?, ?)').bind(runId, list[best].name).run();
  return list[best].db;
}
async function deleteRunData(env, runIds) {
  for (const id of runIds) {
    const db = await dataDb(env, id);
    await db.batch([db.prepare('DELETE FROM pages WHERE run_id = ?').bind(id), db.prepare('DELETE FROM run_blobs WHERE run_id = ?').bind(id)]);
  }
}

async function retentionDays(env) {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'retention_days'").first().catch(() => null);
  return r ? Number(r.value) : 0; // 0 = keep everything
}

// Slim runs older than the retention window: drop crawled pages, exports and raw GSC/GA data,
// keep the run row with its summary (scores, KPIs, opportunities), AI report and history.
async function archiveOldRuns(env) {
  const days = await retentionDays(env);
  if (!days) return { archived: 0 };
  const cutoff = now() - days * DAY;
  const { results } = await env.DB.prepare(
    "SELECT id FROM runs WHERE created_at < ? AND status = 'done' AND (error IS NULL OR error != 'archived') LIMIT 50"
  ).bind(cutoff).all();
  for (const r of results) {
    await deleteRunData(env, [r.id]);
    await env.DB.prepare("UPDATE runs SET gsc_json = NULL, ga_json = NULL, error = 'archived' WHERE id = ?").bind(r.id).run();
  }
  return { archived: results.length };
}

async function getMeta(env, projectId) {
  const { results } = await env.DB.prepare('SELECT key, value FROM project_meta WHERE project_id = ?').bind(projectId).all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

async function saveMeta(env, projectId, p) {
  await env.DB.batch(
    ['money_pages', 'brand_terms', 'lead_event'].map((k) =>
      env.DB.prepare('INSERT OR REPLACE INTO project_meta (project_id, key, value) VALUES (?, ?, ?)').bind(projectId, k, p[k] || '')
    )
  );
}

async function ensureUser(env, email, invitedBy) {
  await env.DB.prepare(
    "INSERT INTO users (email, name, role, invited_by, created_at) VALUES (?, ?, 'member', ?, ?) ON CONFLICT(email) DO NOTHING"
  )
    .bind(email, email, invitedBy, now())
    .run();
}

// Replaces a user's project access with [{id, role: 'viewer'|'editor'}]
async function setAccess(env, email, projects) {
  const stmts = [env.DB.prepare('DELETE FROM project_members WHERE email = ?').bind(email)];
  for (const p of projects || []) {
    stmts.push(
      env.DB.prepare('INSERT INTO project_members (project_id, email, role, added_at) SELECT id, ?, ?, ? FROM projects WHERE id = ?').bind(
        email,
        p.role === 'viewer' ? 'viewer' : 'editor',
        now(),
        String(p.id)
      )
    );
  }
  await env.DB.batch(stmts);
}

async function validateProject(env, user, b) {
  const name = String(b.name || '').trim();
  if (!name) throw new HttpError(400, 'Project name is required');
  const gsc_property = String(b.gsc_property || '').trim();
  if (!gsc_property) throw new HttpError(400, 'Pick a Search Console property');
  let site_url = String(b.site_url || '').trim();
  if (!site_url) site_url = gsc_property.startsWith('sc-domain:') ? `https://${gsc_property.slice(10)}/` : gsc_property;
  try {
    site_url = new URL(site_url).toString();
  } catch {
    throw new HttpError(400, 'Homepage URL is not valid');
  }
  const conn = await env.DB.prepare('SELECT id FROM connections WHERE id = ?').bind(b.connection_id || '').first();
  if (!conn) throw new HttpError(400, 'Pick one of the connected Google accounts');
  return {
    name,
    site_url,
    gsc_property,
    ga4_property: b.ga4_property || null,
    ga4_name: b.ga4_name || null,
    connection_id: conn.id,
    max_pages: Math.min(1000, Math.max(5, Number(b.max_pages) || 25)),
    money_pages: String(b.money_pages || '')
      .split(/\s+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 300)
      .join('\n'),
    brand_terms: String(b.brand_terms || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 30).join(', '),
    lead_event: String(b.lead_event || '').trim().replace(/[^\w]/g, '').slice(0, 40),
  };
}

// ---------- data pulls ----------

const minD = (a, b) => (a < b ? a : b);
const maxD = (a, b) => (a > b ? a : b);

async function pullGsc(token, project, run) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(project.gsc_property)}/searchAnalytics/query`;
  const q = (startDate, endDate, dimensions, rowLimit) =>
    gfetch(token, endpoint, { startDate, endDate, dimensions, rowLimit, type: 'web' }).then((r) => r.rows || []);
  const cur = [run.start_date, run.end_date];
  const prev = [run.prev_start, run.prev_end];
  const [daily, queries, prevQueries, pages, prevPages, pageQueries, devices, countries] = await Promise.all([
    q(minD(run.prev_start, run.start_date), maxD(run.prev_end, run.end_date), ['date'], 1000),
    q(...cur, ['query'], 1000),
    q(...prev, ['query'], 1000),
    q(...cur, ['page'], 1000),
    q(...prev, ['page'], 1000),
    q(...cur, ['page', 'query'], 5000),
    q(...cur, ['device'], 10),
    q(...cur, ['country'], 10),
  ]);
  const row = (r) => ({ c: r.clicks, i: r.impressions, ctr: +r.ctr.toFixed(4), p: +r.position.toFixed(1) });
  const sum = (rows) => {
    const t = rows.reduce((a, r) => ({ c: a.c + r.clicks, i: a.i + r.impressions, pw: a.pw + r.position * r.impressions }), { c: 0, i: 0, pw: 0 });
    return { clicks: t.c, impressions: t.i, ctr: t.i ? t.c / t.i : 0, position: t.i ? t.pw / t.i : 0 };
  };
  return {
    totals: sum(daily.filter((r) => r.keys[0] >= run.start_date && r.keys[0] <= run.end_date)),
    prevTotals: sum(daily.filter((r) => r.keys[0] >= run.prev_start && r.keys[0] <= run.prev_end)),
    daily: daily.map((r) => ({ d: r.keys[0], ...row(r) })),
    queries: queries.map((r) => ({ q: r.keys[0], ...row(r) })),
    prevQueries: prevQueries.map((r) => ({ q: r.keys[0], ...row(r) })),
    pages: pages.map((r) => ({ u: r.keys[0], ...row(r) })),
    prevPages: prevPages.map((r) => ({ u: r.keys[0], ...row(r) })),
    pageQueries: pageQueries.map((r) => ({ u: r.keys[0], q: r.keys[1], ...row(r) })),
    devices: devices.map((r) => ({ k: r.keys[0], ...row(r) })),
    countries: countries.map((r) => ({ k: r.keys[0], ...row(r) })),
  };
}

async function pullGa(token, project, run) {
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/${project.ga4_property}:runReport`;
  const organic = { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } } };
  const cur = { startDate: run.start_date, endDate: run.end_date };
  const prev = { startDate: run.prev_start, endDate: run.prev_end };
  const num = (v) => Number(v?.value || 0);
  const landingReq = (range) => ({
    dateRanges: [range],
    dimensions: [{ name: 'landingPage' }],
    metrics: ['sessions', 'totalUsers', 'engagementRate', 'averageSessionDuration', 'keyEvents', 'bounceRate', 'newUsers', 'screenPageViews'].map((name) => ({ name })),
    dimensionFilter: organic,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 1000,
  });
  const [landing, prevLanding, channels, daily] = await Promise.all([
    gfetch(token, endpoint, landingReq(cur)),
    gfetch(token, endpoint, landingReq(prev)),
    gfetch(token, endpoint, {
      dateRanges: [cur, prev],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: ['sessions', 'totalUsers', 'keyEvents', 'engagementRate'].map((name) => ({ name })),
      dimensionFilter: organic,
      limit: 30,
    }),
    gfetch(token, endpoint, {
      dateRanges: [{ startDate: minD(run.prev_start, run.start_date), endDate: maxD(run.prev_end, run.end_date) }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: organic,
      limit: 1000,
    }),
  ]);
  const landingRow = (r) => ({
    path: r.dimensionValues[0].value,
    sessions: num(r.metricValues[0]),
    users: num(r.metricValues[1]),
    engagementRate: +num(r.metricValues[2]).toFixed(3),
    avgDuration: Math.round(num(r.metricValues[3])),
    keyEvents: num(r.metricValues[4]),
    bounceRate: +num(r.metricValues[5]).toFixed(3),
    newUsers: num(r.metricValues[6]),
    views: num(r.metricValues[7]),
  });
  const channelRows = {};
  for (const r of channels.rows || []) {
    const name = r.dimensionValues[0].value;
    const range = r.dimensionValues[1]?.value === 'date_range_1' ? 'prev' : 'cur';
    channelRows[name] = channelRows[name] || { name, cur: null, prev: null };
    channelRows[name][range] = {
      sessions: num(r.metricValues[0]),
      users: num(r.metricValues[1]),
      keyEvents: num(r.metricValues[2]),
      engagementRate: num(r.metricValues[3]),
    };
  }
  return {
    landing: (landing.rows || []).map(landingRow),
    prevLanding: (prevLanding.rows || []).map(landingRow),
    channels: Object.values(channelRows).sort((a, b) => (b.cur?.sessions || 0) - (a.cur?.sessions || 0)),
    daily: (daily.rows || [])
      .map((r) => {
        const d = r.dimensionValues[0].value;
        return { d: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, s: num(r.metricValues[0]) };
      })
      .sort((a, b) => a.d.localeCompare(b.d)),
  };
}

// Fetches a page of the project's own site (never arbitrary hosts) so the browser can analyse it.
async function fetchPage(project, raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new HttpError(400, 'Invalid URL');
  }
  if (!/^https?:$/.test(target.protocol) || !hostAllowed(project, target)) throw new HttpError(403, 'URL is outside this project\'s site');
  const started = now();
  const redirects = [];
  let res;
  let current = target.toString();
  for (let hop = 0; hop < 6; hop++) {
    res = await fetch(current, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SearchverseBot/1.0; +https://developers.google.com/search)',
        accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.5',
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current);
      redirects.push({ from: current, to: next.toString(), status: res.status });
      if (!hostAllowed(project, next)) break;
      current = next.toString();
      continue;
    }
    break;
  }
  const type = res.headers.get('content-type') || '';
  let html = '';
  if (/html|xml|text\/plain/.test(type)) {
    html = await res.text();
    if (html.length > 2_000_000) html = html.slice(0, 2_000_000);
  }
  return {
    url: target.toString(),
    finalUrl: current,
    status: res.status,
    redirects,
    contentType: type,
    xRobotsTag: res.headers.get('x-robots-tag') || '',
    ms: now() - started,
    bytes: html.length,
    html,
  };
}

// ---------- Gemini ----------

function seoPrompt(project, input, maxChars) {
  return `You are a senior SEO + CRO lead writing the monthly performance review for "${project.name}" (${project.site_url}).
Data below: Google Search Console (current vs comparison period, branded vs non-branded queries, biggest winning/losing queries and pages),
GA4 organic landing pages (sessions, users, bounce, key events, current vs comparison), and an on-page crawl (scores, failed checks, schema,
JS-rendering risk, navigation/footer link texts, external link counts). "money": true marks business-critical pages. If "scope" is set,
only those line-of-business (LOB) URLs are in scope.

WRITE LIKE THIS EXAMPLE (same style: counts, numbers, named pages/queries):
- What went well: "20 non-branded queries grew +38% clicks (12.4k → 17.1k), concentrated on 6 /blog/broadband/ pages."
- How we achieved it: "Those 6 pages average 84 on-page score with FAQ schema and the query in title + H1; supporting blogs X and Y link to them."
- What didn't work: "14 /plans/ pages lost 9.2k clicks (-31%); positions fell 4.1 → 7.8 across most of them at once — consistent with a ranking/core update rather than a page issue."
- How to improve: "11 pages are missing their top query in title/H1 (list); 5 high-impression pages have no schema."
- Action plan: workstreams YOU choose from what the data shows (any SEO area), each with concrete tasks, URLs, evidence and owner.

STRICT RULES:
1. Every point must name exact URLs/queries and quote numbers from the data (counts, clicks, % change, positions, scores).
2. Give the exact change: new title/meta/H1 text, schema type to add, exact blog titles + slugs + target query, exact nav/footer anchor text and target URL.
3. Never write vague advice ("optimize", "improve", "enhance", "consider", "leverage", "focus on", "high-quality content") without the concrete change.
4. Explain causes only from the data: say "likely ranking volatility / core update" only when many pages dropped in position together; otherwise point to page-level causes.
5. No competitor or backlink data is available: for external links/backlinks, state exactly what to audit (which pages, which tool/report) instead of inventing competitor numbers.
6. Technical items must say who owns them (dev / seo / content) and what evidence triggered them (e.g. "JS-rendering risk on /x: 80 words in raw HTML, 45 scripts").
7. Prioritise money pages and non-branded growth. Never invent data.
7b. Keep the four review sections SHORT and scannable: "point" = one crisp bullet (max ~14 words, lead with the number),
   "evidence" = one line (max ~25 words). ALWAYS fill "pages" (full URLs) and "queries" (exact query text) with the specific items
   behind the point. In "what_went_well" list ONLY pages/queries whose clicks went UP; in "what_didnt_work" ONLY ones that went DOWN
   (check the numbers before listing — never put a declining page under "went well"). Lists (3-10 each; "queries" is REQUIRED on every bullet in all four sections, using exact query text from the data) — the UI lets people click a bullet to see those pages/queries with their numbers.
8. Every action-plan item must be falsifiable: state the observation it rests on, what it depends on (another task or nothing),
   how we would know it failed (a concrete check after N weeks), and the leading indicator to watch first (e.g. impressions for query X, CTR on URL Y).
9. Current Google guidance (2026): FAQ rich results were retired in May 2026 (do not recommend FAQPage markup for rich snippets; Q&A content itself is still useful);
   Google Search ignores llms.txt; Trust is the most important part of E-E-A-T; AI Overviews/AI Mode use normal Search crawling (Googlebot) and indexing,
   so server-rendered, clearly structured, attributable content is what gets cited. Use "aiSearchGeo" data for AI-search recommendations.

${(project.ignored || []).length ? `10. The team marked these past points as IRRELEVANT for this site — do not repeat them or close variants:\n${project.ignored.map((x) => '   - ' + x).join('\n')}\n` : ''}
Return ONLY JSON in this exact shape:
{
  "summary": "3-4 sentence overview with the headline numbers",
  "health": "good" | "needs_work" | "poor",
  "what_went_well": [{"point": "", "evidence": "numbers", "queries": [""], "pages": [""]}],
  "how_we_achieved_it": [{"point": "", "evidence": "on-page scores / schema / content facts from the crawl", "queries": [""], "pages": [""]}],
  "what_didnt_work": [{"point": "", "evidence": "numbers", "likely_cause": "", "queries": [""], "pages": [""]}],
  "how_to_improve": [{"point": "", "evidence": "", "queries": [""], "pages": [""]}],
  "action_plan": [{"area": "workstream name you choose, e.g. On-page & titles, Schema, Topical authority / new blogs, Internal linking, Rendering (SSR/CSR), Indexation, CTR & snippets, Cannibalisation, Page experience, E-E-A-T, Backlinks — only areas the data justifies, most impactful first",
    "items": [{"task": "the exact change (exact text, exact blog title + slug + target query, exact anchor → URL, exact schema type...)", "urls": [""], "evidence": "numbers that justify it", "owner": "dev|seo|content", "priority": "high|medium|low",
      "observation": "the first-principle observation this rests on", "depends_on": "other task or 'none'", "failure_check": "how we'd know it failed, e.g. 'if CTR on X is still < 2% after 4 weeks'", "leading_indicator": "first metric that should move"}]}],
  "ai_search_geo": [{"url": "", "issue": "", "change": "exact change: question H2 text, 40-60 word answer paragraph topic, author/date to add, table to add, crawler rule to fix…", "evidence": "", "failure_check": ""}],
  "cro": [{"url": "", "evidence": "GA numbers", "hypothesis": "", "change": "exact change + location", "metric": ""}],
  "quick_wins": [{"query": "", "url": "", "position": 0, "impressions": 0, "action": "exact change"}]
}
Limits: 10-15 items in each of the first four sections (cover different query clusters, page groups, LOBs, devices of evidence — no near-duplicates), 4-8 ai_search_geo items, 4-7 action_plan areas with 2-6 items each (use the internalLinkOpportunities, renderModes/csrPages and navigationFooter data where relevant), 3-6 cro, up to 8 quick wins.

DATA:
${JSON.stringify(input).slice(0, maxChars)}`;
}

function parseAiJson(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {}
    }
    return null;
  }
}

// Ask Gemini with Google Search grounding and record what it answered and which sites it cited.
async function checkPrompt(env, key, project, meta, prompt) {
  const model = env.GEMINI_SEARCH_MODEL || env.GEMINI_MODEL || 'gemini-3.8-flash';
  const host = (() => { try { return new URL(project.site_url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const domain = project.gsc_property.startsWith('sc-domain:') ? project.gsc_property.slice(10) : host;
  const brands = String(meta.brand_terms || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const base = { engine: 'Gemini + Google Search', model, answer: '', queries: [], sources: [], mentioned: false, cited: false };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      if ((res.status === 429 || res.status === 503) && attempt < 2) { await sleep(3000 * (attempt + 1)); continue; }
      return { ...base, error: d.error?.message || res.statusText };
    }
    const cand = d.candidates?.[0] || {};
    const answer = (cand.content?.parts || []).map((x) => x.text || '').join('').trim();
    const gm = cand.groundingMetadata || {};
    const sources = (gm.groundingChunks || []).map((c) => ({ title: c.web?.title || '', uri: c.web?.uri || '' })).filter((x) => x.title || x.uri);
    const srcDomain = (x) => (x.title || '').toLowerCase().replace(/^www\./, '');
    const cited = !!domain && sources.some((x) => srcDomain(x).endsWith(domain) || x.uri.includes(domain));
    const low = answer.toLowerCase();
    const mentioned = brands.some((t) => low.includes(t)) || (!!domain && low.includes(domain));
    return { ...base, model: d.modelVersion || model, answer: answer.slice(0, 20000), queries: gm.webSearchQueries || [], sources: sources.slice(0, 30), mentioned, cited };
  }
  return { ...base, error: 'Gemini is busy, try again' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geminiOnce(key, model, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 32768 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`${model}: ${data.error?.message || res.statusText}`);
    e.retry = res.status === 429 || res.status === 503 || res.status === 500;
    throw e;
  }
  const out = parseAiJson((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
  if (!out) throw new Error(`${model}: returned no valid JSON`);
  return out;
}

// Free AI with fallbacks: Gemini (primary model with retries, then backup Gemini models),
// then Cloudflare Workers AI (free daily allowance, no key needed).
async function askAI(env, key, project, input) {
  const errors = [];
  if (key) {
    const models = [env.GEMINI_MODEL || 'gemini-3.8-flash',
      ...(env.GEMINI_FALLBACK_MODELS || 'gemini-flash-latest,gemini-flash-lite-latest').split(',').map((x) => x.trim())]
      .filter((v, i, arr) => v && arr.indexOf(v) === i);
    const prompt = seoPrompt(project, input, 120000);
    for (const [i, model] of models.entries()) {
      for (let attempt = 0; attempt < (i === 0 ? 3 : 1); attempt++) {
        try {
          return { ...(await geminiOnce(key, model, prompt)), provider: `Gemini (${model})` };
        } catch (e) {
          errors.push(e.message);
          if (!e.retry) break;
          if (attempt < 2 && i === 0) await sleep(2000 * (attempt + 1));
        }
      }
    }
  }
  if (env.AI) {
    const model = env.WORKERS_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    try {
      const r = await env.AI.run(model, {
        messages: [
          { role: 'system', content: 'You are a senior SEO consultant. Reply with valid JSON only.' },
          { role: 'user', content: seoPrompt(project, input, 45000) },
        ],
        max_tokens: 7000,
        temperature: 0.4,
      });
      const out = typeof r.response === 'object' ? r.response : parseAiJson(r.response);
      if (out) return { ...out, provider: `Cloudflare Workers AI (${model.split('/').pop()})` };
      errors.push('Workers AI: returned no valid JSON');
    } catch (e) {
      errors.push('Workers AI: ' + e.message);
    }
  }
  throw new HttpError(503, 'AI is busy right now, please retry in a minute. ' + errors.slice(-2).join(' | '));
}
