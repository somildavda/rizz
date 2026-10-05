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

  if (path === '/auth/login' || path === '/auth/connect') {
    const mode = path === '/auth/login' ? 'login' : 'connect';
    let email = null;
    if (mode === 'connect') {
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
      scope: mode === 'login' ? LOGIN_SCOPES : DATA_SCOPES,
      state,
      prompt: mode === 'login' ? 'select_account' : 'consent select_account',
    });
    if (mode === 'connect') params.set('access_type', 'offline');
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
      connections: conns.n,
    });
  }

  const user = await requireUser(req, env);
  const DB = env.DB;

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
        (SELECT summary_json FROM runs r WHERE r.project_id = p.id AND r.status = 'done' ORDER BY created_at DESC LIMIT 1) AS last_summary
        , CASE WHEN ? = 'admin' THEN 'admin' ELSE m.role END AS my_role
       FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.email = ?
       WHERE ? = 'admin' OR m.email IS NOT NULL ORDER BY p.created_at DESC`
    )
      .bind(user.role, user.email, user.role)
      .all();
    return json({
      projects: results.map((p) => {
        const s = p.last_summary ? JSON.parse(p.last_summary) : null;
        delete p.last_summary;
        return { ...p, kpis: s?.kpis || null };
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
    return json({ id: pid });
  }
  if ((m = path.match(/^\/api\/projects\/(\w+)$/))) {
    const project = await getProject(env, m[1], user.email);
    if (method === 'GET') {
      const { results: members } = await DB.prepare('SELECT email, role FROM project_members WHERE project_id = ?').bind(project.id).all();
      const conn = project.connection_id
        ? await DB.prepare('SELECT google_email FROM connections WHERE id = ?').bind(project.connection_id).first()
        : null;
      return json({ project: { ...project, members, connection_email: conn?.google_email || null } });
    }
    requireAdmin(user);
    if (method === 'PUT') {
      const p = await validateProject(env, user, await body(req));
      await DB.prepare(
        `UPDATE projects SET name = ?, site_url = ?, gsc_property = ?, ga4_property = ?, ga4_name = ?, connection_id = ?, max_pages = ? WHERE id = ?`
      )
        .bind(p.name, p.site_url, p.gsc_property, p.ga4_property, p.ga4_name, p.connection_id, p.max_pages, project.id)
        .run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await DB.batch([
        DB.prepare('DELETE FROM pages WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)').bind(project.id),
        DB.prepare('DELETE FROM runs WHERE project_id = ?').bind(project.id),
        DB.prepare('DELETE FROM project_members WHERE project_id = ?').bind(project.id),
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
    return json({ ok: true });
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

  // runs
  if ((m = path.match(/^\/api\/projects\/(\w+)\/runs$/))) {
    const project = await getProject(env, m[1], user.email);
    if (method === 'GET') {
      const { results } = await DB.prepare(
        `SELECT id, created_at, created_by, status, start_date, end_date, score, summary_json, error
         FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`
      )
        .bind(project.id)
        .all();
      return json({
        runs: results.map((r) => {
          const s = r.summary_json ? JSON.parse(r.summary_json) : null;
          delete r.summary_json;
          return { ...r, kpis: s?.kpis || null, scores: s?.scores || null };
        }),
      });
    }
    if (method === 'POST') {
      requireRun(project);
      if (!project.connection_id) throw new HttpError(400, 'This project has no Google account connected');
      const b = await body(req).catch(() => ({}));
      const days = [7, 28, 90].includes(Number(b.days)) ? Number(b.days) : 28;
      const pr = periods(days);
      const rid = id();
      await DB.prepare(
        `INSERT INTO runs (id, project_id, created_by, created_at, status, start_date, end_date, prev_start, prev_end)
         VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`
      )
        .bind(rid, project.id, user.email, now(), pr.start, pr.end, pr.pstart, pr.pend)
        .run();
      return json({ run: { id: rid, ...pr } });
    }
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)$/))) {
    const { run, project } = await getRun(env, m[1], user.email);
    if (method === 'GET') {
      const { results: pages } = await DB.prepare('SELECT url, onpage_score, content_score, data_json FROM pages WHERE run_id = ?')
        .bind(run.id)
        .all();
      return json({
        run: {
          ...run,
          summary: run.summary_json ? JSON.parse(run.summary_json) : null,
          gsc: run.gsc_json ? JSON.parse(run.gsc_json) : null,
          ga: run.ga_json ? JSON.parse(run.ga_json) : null,
          ai: run.ai_json ? JSON.parse(run.ai_json) : null,
          summary_json: undefined,
          gsc_json: undefined,
          ga_json: undefined,
          ai_json: undefined,
        },
        pages: pages.map((p) => ({ url: p.url, onpage_score: p.onpage_score, content_score: p.content_score, ...JSON.parse(p.data_json) })),
        project: { id: project.id, name: project.name, site_url: project.site_url },
      });
    }
    if (method === 'DELETE') {
      requireAdmin(user);
      await DB.batch([DB.prepare('DELETE FROM pages WHERE run_id = ?').bind(run.id), DB.prepare('DELETE FROM runs WHERE id = ?').bind(run.id)]);
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
    const stmts = (b.pages || []).slice(0, 50).map((p) => {
      const { url: pageUrl, onpage_score, content_score, ...rest } = p;
      return DB.prepare('INSERT OR REPLACE INTO pages (run_id, url, onpage_score, content_score, data_json) VALUES (?, ?, ?, ?, ?)').bind(
        run.id,
        String(pageUrl),
        Math.round(onpage_score) || 0,
        Math.round(content_score) || 0,
        JSON.stringify(rest)
      );
    });
    if (stmts.length) await DB.batch(stmts);
    return json({ ok: true, saved: stmts.length });
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)\/finish$/)) && method === 'POST') {
    const { run, project } = await getRun(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    await DB.prepare('UPDATE runs SET status = ?, score = ?, summary_json = ?, error = ? WHERE id = ?')
      .bind(b.error ? 'error' : 'done', Math.round(b.score) || 0, JSON.stringify(b.summary || {}), b.error || null, run.id)
      .run();
    return json({ ok: true });
  }

  if ((m = path.match(/^\/api\/runs\/(\w+)\/ai$/)) && method === 'POST') {
    const { run, project } = await getRun(env, m[1], user.email);
    requireRun(project);
    const b = await body(req);
    const key = user.gemini_key_enc ? await decrypt(env, user.gemini_key_enc) : env.GEMINI_API_KEY;
    if (!key) throw new HttpError(400, 'No Gemini API key. Add your free key in Settings (aistudio.google.com/apikey).');
    const ai = await askGemini(env, key, project, b.input);
    ai.generated_at = now();
    await DB.prepare('UPDATE runs SET ai_json = ? WHERE id = ?').bind(JSON.stringify(ai), run.id).run();
    return json({ ai });
  }

  throw new HttpError(404, 'Not found');
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
    max_pages: Math.min(100, Math.max(5, Number(b.max_pages) || 25)),
  };
}

// ---------- data pulls ----------

async function pullGsc(token, project, run) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(project.gsc_property)}/searchAnalytics/query`;
  const q = (startDate, endDate, dimensions, rowLimit) =>
    gfetch(token, endpoint, { startDate, endDate, dimensions, rowLimit, type: 'web' }).then((r) => r.rows || []);
  const cur = [run.start_date, run.end_date];
  const prev = [run.prev_start, run.prev_end];
  const [daily, queries, prevQueries, pages, prevPages, pageQueries, devices, countries] = await Promise.all([
    q(run.prev_start, run.end_date, ['date'], 500),
    q(...cur, ['query'], 1000),
    q(...prev, ['query'], 1000),
    q(...cur, ['page'], 500),
    q(...prev, ['page'], 500),
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
    totals: sum(daily.filter((r) => r.keys[0] >= run.start_date)),
    prevTotals: sum(daily.filter((r) => r.keys[0] <= run.prev_end)),
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
  const [landing, channels, daily] = await Promise.all([
    gfetch(token, endpoint, {
      dateRanges: [cur],
      dimensions: [{ name: 'landingPage' }],
      metrics: ['sessions', 'totalUsers', 'engagementRate', 'averageSessionDuration', 'keyEvents', 'bounceRate'].map((name) => ({ name })),
      dimensionFilter: organic,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 500,
    }),
    gfetch(token, endpoint, {
      dateRanges: [cur, prev],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: ['sessions', 'totalUsers', 'keyEvents', 'engagementRate'].map((name) => ({ name })),
      limit: 30,
    }),
    gfetch(token, endpoint, {
      dateRanges: [{ startDate: run.prev_start, endDate: run.end_date }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: organic,
      limit: 400,
    }),
  ]);
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
    landing: (landing.rows || []).map((r) => ({
      path: r.dimensionValues[0].value,
      sessions: num(r.metricValues[0]),
      users: num(r.metricValues[1]),
      engagementRate: +num(r.metricValues[2]).toFixed(3),
      avgDuration: Math.round(num(r.metricValues[3])),
      keyEvents: num(r.metricValues[4]),
      bounceRate: +num(r.metricValues[5]).toFixed(3),
    })),
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

async function askGemini(env, key, project, input) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const prompt = `You are a senior technical SEO and content strategist at an SEO agency. Analyse the data for the website "${project.name}" (${project.site_url}).
The data comes from Google Search Console, GA4 (organic sessions) and an on-page crawl of the top pages, with rule-based scores already computed.
Give specific, data-backed, prioritised recommendations. Reference actual queries, URLs and numbers. Avoid generic advice.
For title/meta suggestions, include the page's most important query naturally; titles <= 60 chars, meta descriptions 140-155 chars.

Return ONLY JSON in this exact shape:
{
  "summary": "3-5 sentence executive summary of performance and the biggest levers",
  "health": "good" | "needs_work" | "poor",
  "priorities": [{"title": "", "why": "data-backed reason", "how": "concrete steps", "impact": "high|medium|low", "effort": "high|medium|low", "urls": [""]}],
  "page_recommendations": [{"url": "", "problem": "", "title_suggestion": "", "meta_suggestion": "", "h1_suggestion": "", "content_gaps": ["missing subtopic / query to cover"], "internal_links": "suggestion"}],
  "quick_wins": [{"query": "", "url": "", "position": 0, "action": ""}],
  "content_ideas": [{"topic": "", "target_query": "", "type": "new page|expand existing|FAQ|guide", "rationale": ""}],
  "technical": [{"issue": "", "fix": "", "urls": [""]}],
  "risks": ["declines, cannibalisation or anything worrying"]
}
Limit: 6-8 priorities, up to 10 page_recommendations (worst/most valuable pages first), up to 10 quick_wins, 5 content_ideas.

DATA:
${JSON.stringify(input).slice(0, 120000)}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 429 ? 429 : 502, `Gemini: ${data.error?.message || res.statusText}`);
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  try {
    return JSON.parse(text.replace(/^```json\s*|```\s*$/g, ''));
  } catch {
    return { summary: text, priorities: [] };
  }
}
