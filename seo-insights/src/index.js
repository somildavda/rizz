import { normalizeRows, analyze, analyzeQueries } from './analyze.js';
import { parseCsv } from './csv.js';
import { fetchGsc, fetchSheet, listSites, GOOGLE_SCOPES } from './gsc.js';
import { SYSTEM_PROMPT, ANALYST_PROMPT, userPrompt } from './prompt.js';
import { HTML, LOGIN } from './ui.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html;charset=utf-8' } });

function cookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

const DAY = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);

// Monday-to-Sunday week starting at `week` (YYYY-MM-DD), plus the week before.
function weekRange(week) {
  const start = new Date(week + 'T00:00:00Z');
  return { start, end: new Date(+start + 6 * DAY), prevStart: new Date(+start - 7 * DAY), prevEnd: new Date(+start - DAY) };
}

// --- Encrypted cookies (AES-GCM, key derived from the passcode) hold the Google sign-in.
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function cookieKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('seo-insights:' + (env.ACCESS_TOKEN || 'dev')));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cookieKey(env), data));
  return b64u(iv) + '.' + b64u(ct);
}

async function unseal(env, str) {
  try {
    const [iv, ct] = str.split('.').map(unb64u);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await cookieKey(env), ct)));
  } catch {
    return null;
  }
}

const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// --- Server-side storage (KV binding SETTINGS): keys, Google sign-in, clients and reports.
// Without the binding everything falls back to cookies and the browser.
async function kvGet(env, key, fallback) {
  if (!env.SETTINGS) return fallback;
  try { return JSON.parse(await env.SETTINGS.get(key)) ?? fallback; } catch { return fallback; }
}
async function kvPut(env, key, value) {
  if (env.SETTINGS) await env.SETTINGS.put(key, JSON.stringify(value));
}

const toLogin = (msg) => new Response(null, { status: 302, headers: { location: '/?error=' + encodeURIComponent(msg) } });
const SESSION_DAYS = 365;

// Google app credentials: Worker secrets first, else saved once from the login page.
async function googleApp(env) {
  const saved = await kvGet(env, 'settings', {});
  return { cid: env.GOOGLE_CLIENT_ID || saved.cid, secret: env.GOOGLE_CLIENT_SECRET || saved.secret, saved };
}

// Login with Google: /setup (first time), /auth/google (start), /auth/callback (finish), /logout, /auth/reset.
async function authRoutes(request, env, url) {
  const redirectUri = url.origin + '/auth/callback';

  // First-time setup, protected by the deploy passcode.
  if (url.pathname === '/setup' && request.method === 'POST') {
    const f = await request.formData();
    if (!env.ACCESS_TOKEN || f.get('pass') !== env.ACCESS_TOKEN) return toLogin('Wrong setup passcode.');
    const cid = String(f.get('cid') || '').trim(), secret = String(f.get('secret') || '').trim();
    if (!/\.apps\.googleusercontent\.com$/.test(cid)) return toLogin('The Client ID should end with .apps.googleusercontent.com');
    if (!secret) return toLogin('Paste the Client secret too.');
    const saved = await kvGet(env, 'settings', {});
    await kvPut(env, 'settings', { ...saved, cid, secret });
    return new Response(null, { status: 302, headers: { location: '/auth/google' } });
  }

  if (url.pathname === '/auth/google') {
    const { cid, secret } = await googleApp(env);
    if (!cid || !secret) return toLogin('Finish the one-time setup first.');
    const state = crypto.randomUUID();
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
      client_id: cid, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_SCOPES,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    return new Response(null, { status: 302, headers: { location: auth.toString(), 'set-cookie': setCookie('g_state', state, 600) } });
  }

  if (url.pathname === '/auth/callback') {
    const err = url.searchParams.get('error');
    if (err) return toLogin(err === 'access_denied'
      ? 'Google said access denied. In Google Cloud → Audience, click "Publish app" (or add your email as a test user), then try again.'
      : 'Google returned: ' + err);
    if (!cookie(request, 'g_state') || cookie(request, 'g_state') !== url.searchParams.get('state'))
      return toLogin('The sign-in took too long. Please try again.');
    const { cid, secret, saved } = await googleApp(env);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: cid, client_secret: secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const tok = await res.json();
    if (!tok.refresh_token) {
      const why = tok.error_description || tok.error || 'Google sent no refresh token';
      return toLogin(/redirect_uri/i.test(why)
        ? 'Redirect URI mismatch. In Google Cloud → Clients, add exactly ' + redirectUri
        : /invalid_client|unauthorized|secret is invalid/i.test(why)
          ? 'The Client secret doesn\'t match the Client ID. Click "Redo setup" and paste both again from the same client.' : why);
    }
    let email = '';
    try { email = JSON.parse(new TextDecoder().decode(unb64u(tok.id_token.split('.')[1]))).email.toLowerCase(); } catch {}
    if (!email) return toLogin('Google did not share your email address. Please try again.');
    // The first account to sign in becomes the owner; after that only allowed emails get in.
    const allowed = saved.allowed?.length ? saved.allowed : [email];
    if (!allowed.includes(email)) return toLogin(email + ' does not have access. Ask the owner (' + allowed[0] + ') to add you in Settings.');
    await kvPut(env, 'settings', { ...saved, allowed });
    await kvPut(env, 'google:' + email, { cid, secret, rt: tok.refresh_token, email });
    const headers = new Headers({ location: '/' });
    headers.append('set-cookie', setCookie('sv_session', await seal(env, { email, exp: Date.now() + SESSION_DAYS * 864e5 }), SESSION_DAYS * 86400));
    headers.append('set-cookie', setCookie('g_state', '', 0));
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === '/logout')
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': setCookie('sv_session', '', 0) } });
  return null;
}

async function loadRows(body, env) {
  const range = body.week ? weekRange(body.week) : null;
  if (body.source === 'gsc') {
    if (!range) throw new Error('Pick a week.');
    return fetchGsc(env, body.site || env.GSC_SITE_URL, range);
  }
  let raw;
  if (body.source === 'sheet') {
    // Signed in with Google: any sheet link works. Otherwise a "Publish to web" CSV link (or a sheet shared with the service account).
    const idFrom = (v) => (v || '').match(/\/d\/([\w-]+)/)?.[1];
    const sheetId = idFrom(body.sheetId) || body.sheetId
      || (env.GOOGLE_OAUTH && !/output=csv|\/pub/.test(body.csvUrl || '') && idFrom(body.csvUrl));
    if (sheetId) raw = await fetchSheet(env, sheetId, body.range || 'A:Z');
    else {
      const res = await fetch(body.csvUrl);
      if (!res.ok) throw new Error('Could not fetch sheet CSV (is it published to the web?)');
      raw = parseCsv(await res.text());
    }
  } else raw = parseCsv(body.csv || '');
  return splitQueryRows(range ? filterWeek(raw, range) : raw);
}

// Sheets with a Date / Week column: keep the selected week and attach last week's numbers as prev_*.
function filterWeek(raw, { start, end, prevStart, prevEnd }) {
  if (!raw.length) return raw;
  const keys = Object.keys(raw[0]);
  const dKey = keys.find((k) => /^(date|day|week|week start|week of|week starting)$/i.test(k.trim()));
  if (!dKey) return raw;
  const pKey = keys.find((k) => /^(page|page path|pagepath|url|landing page|path)$/i.test(k.trim()));
  const qKey = keys.find((k) => /^(query|queries|keyword)$/i.test(k.trim()));
  const inRange = (r, a, b) => { const d = new Date(String(r[dKey]).trim()); return d >= a && d <= new Date(+b + DAY - 1); };
  const cur = raw.filter((r) => inRange(r, start, end));
  if (!cur.length) throw new Error(`No rows in the sheet for the week of ${iso(start)}.`);
  const prev = raw.filter((r) => inRange(r, prevStart, prevEnd));
  const num = (v) => parseFloat(String(v ?? '').replace(/[%,]/g, '')) || 0;
  const col = (row, re) => Object.keys(row).find((k) => re.test(k.trim()));
  const sum = (rows) => {
    const out = {};
    for (const r of rows) {
      const id = r[pKey] + '\u0000' + (qKey ? r[qKey] : '');
      const o = (out[id] ||= { [pKey]: r[pKey], ...(qKey && { [qKey]: r[qKey] }), Clicks: 0, Impressions: 0, _pos: 0, Conversions: 0 });
      const imp = num(r[col(r, /^(impressions|impr)$/i)]);
      o.Clicks += num(r[col(r, /^(clicks|url clicks)$/i)]); o.Impressions += imp;
      o._pos += num(r[col(r, /position/i)]) * imp; o.Conversions += num(r[col(r, /^(conversions|key events|leads|goals)$/i)]);
    }
    for (const o of Object.values(out)) { o.Position = o.Impressions ? o._pos / o.Impressions : ''; delete o._pos; if (!o.Conversions) delete o.Conversions; }
    return out;
  };
  const c = sum(cur), p = sum(prev);
  return Object.entries(c).map(([id, r]) => ({
    ...r, 'Prev Clicks': p[id]?.Clicks ?? 0, 'Prev Impressions': p[id]?.Impressions ?? 0, 'Prev Position': p[id]?.Position ?? '',
  }));
}

// A page+query export (has a Query column) -> page totals plus query rows.
function splitQueryRows(raw) {
  const qKey = raw.length && Object.keys(raw[0]).find((k) => /^(query|queries|top queries|keyword)$/i.test(k.trim()));
  if (!qKey) return raw;
  const rows = normalizeRows(raw);
  const queries = rows.map((r, i) => ({ ...r, query: raw[i][qKey] }));
  const byPage = {};
  for (const q of queries) {
    const p = (byPage[q.page] ||= { page: q.page, clicks: 0, impressions: 0, _pos: 0, _ppos: 0, 'prev clicks': null, 'prev impressions': null });
    p.clicks += q.clicks || 0; p.impressions += q.impressions || 0; p._pos += (q.position || 0) * (q.impressions || 0);
    if (q.prev_clicks !== null) {
      p['prev clicks'] += q.prev_clicks; p['prev impressions'] += q.prev_impressions || 0;
      p._ppos += (q.prev_position || 0) * (q.prev_impressions || 0);
    }
  }
  const pages = Object.values(byPage).map(({ _pos, _ppos, ...p }) => ({
    ...p, position: p.impressions ? _pos / p.impressions : '',
    'prev position': p['prev impressions'] ? _ppos / p['prev impressions'] : '',
  }));
  return { rows: pages, queries };
}

async function callAI(env, system, content, max_tokens = 4000) {
  if (env.GEMINI_API_KEY) return callGemini(env, system, content, max_tokens);
  if (env.ANTHROPIC_API_KEY) return callClaude(env, system, content, max_tokens);
  throw new Error('Add your free Gemini API key in Settings to get AI recommendations.');
}

// Daily Gemini usage (requests and tokens), kept for the last 30 days.
async function recordUsage(env, model, meta) {
  if (!env.SETTINGS) return;
  const day = new Date().toISOString().slice(0, 10);
  const u = await kvGet(env, 'usage', {});
  const d = (u[day] ||= { requests: 0, input: 0, output: 0, model: '' });
  d.requests++; d.input += meta?.promptTokenCount || 0;
  d.output += (meta?.candidatesTokenCount || 0) + (meta?.thoughtsTokenCount || 0); d.model = model;
  for (const k of Object.keys(u).sort().slice(0, -30)) delete u[k];
  await kvPut(env, 'usage', u);
}

async function callGemini(env, system, content, maxOutputTokens) {
  // Google retires model names over time, so fall back to the "latest" aliases when one is unavailable.
  const models = [...new Set([env.GEMINI_MODEL || 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-pro-latest'])];
  let lastError;
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: content }] }],
        generationConfig: { maxOutputTokens: Math.max(maxOutputTokens, 8000), temperature: 0.4 },
      }),
    });
    const data = await res.json();
    if (data.error) {
      lastError = 'Gemini: ' + data.error.message;
      if (res.status === 404 || /no longer available|not found|not supported/i.test(data.error.message)) continue;
      throw new Error(lastError);
    }
    await recordUsage(env, model, data.usageMetadata);
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) throw new Error('Gemini returned no text (' + (data.candidates?.[0]?.finishReason || 'unknown') + ')');
    return text;
  }
  throw new Error(lastError);
}

async function callClaude(env, system, content, max_tokens = 4000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-opus-5-5',
      max_tokens,
      system,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('Claude: ' + data.error.message);
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const r = await authRoutes(request, env, url);
    if (r) return r;

    const session = await unseal(env, cookie(request, 'sv_session') || '');
    if (!session || session.exp < Date.now()) {
      if (url.pathname.startsWith('/api/')) return json({ error: 'Please sign in again.' }, 401);
      const { cid, secret } = await googleApp(env);
      return html(LOGIN(!!(cid && secret), url.searchParams.get('error'), url.origin + '/auth/callback'));
    }

    const saved = await kvGet(env, 'settings', {});
    const google = await kvGet(env, 'google:' + session.email, null);
    env = { ...env };
    if (google) env.GOOGLE_OAUTH = google;
    if (saved.gemini) env.GEMINI_API_KEY = saved.gemini;
    const isOwner = (saved.allowed || [])[0] === session.email;

    if (url.pathname === '/api/google')
      return json({
        connected: !!google, email: session.email, owner: isOwner, allowed: isOwner ? saved.allowed : undefined,
        gemini: !!env.GEMINI_API_KEY, serverStorage: !!env.SETTINGS, usage: await kvGet(env, 'usage', {}),
      });

    // Keys sent from the Settings page override the saved ones for this request.
    let body = {};
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      body = await request.json().catch(() => ({}));
      if (body.keys?.gemini) env.GEMINI_API_KEY = body.keys.gemini;
      if (body.keys?.gsc) env.GSC_SERVICE_ACCOUNT = body.keys.gsc;
      delete body.keys;
    }

    // Save the Gemini key on the server so every browser can use it.
    if (url.pathname === '/api/settings' && request.method === 'POST') {
      if (!env.SETTINGS) return json({ saved: false });
      const next = { ...saved };
      if ('gemini' in body) next.gemini = String(body.gemini || '').trim();
      await kvPut(env, 'settings', next);
      return json({ saved: true });
    }

    if (url.pathname === '/api/access' && request.method === 'POST') {
      if (!isOwner) return json({ error: 'Only the owner can change access.' }, 403);
      const list = [...new Set([session.email, ...(body.emails || []).map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@'))])];
      await kvPut(env, 'settings', { ...saved, allowed: list });
      return json({ allowed: list });
    }

    // Clients and report history, shared across browsers.
    if (url.pathname === '/api/data') {
      if (request.method === 'POST') {
        if (Array.isArray(body.clients)) await kvPut(env, 'clients', body.clients);
        if (Array.isArray(body.history)) await kvPut(env, 'history', body.history.slice(0, 100));
        return json({ saved: !!env.SETTINGS });
      }
      return json({ serverStorage: !!env.SETTINGS, clients: await kvGet(env, 'clients', null), history: await kvGet(env, 'history', null) });
    }

    if (url.pathname === '/api/sites' && request.method === 'POST') {
      if (!env.GOOGLE_OAUTH && !env.GSC_SERVICE_ACCOUNT) return json({ error: 'Sign in with Google in Settings first.' }, 400);
      try {
        return json({ sites: await listSites(env), email: env.GOOGLE_OAUTH?.email || JSON.parse(env.GSC_SERVICE_ACCOUNT).client_email });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }
    if (url.pathname === '/') return new Response(HTML, { headers: { 'content-type': 'text/html;charset=utf-8' } });

    if (url.pathname === '/api/ask' && request.method === 'POST') {
            try {
        const b = body;
        const answer = await callAI(env, ANALYST_PROMPT,
          `Client: ${b.client || 'n/a'}\n\nFindings JSON:\n${JSON.stringify(b.findings)}\n\nClient summary already written:\n${b.summary || 'none'}\n\nQuestion: ${b.question}`, 3000);
        return json({ answer });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      try {
        const loaded = await loadRows(body, env);
        const rows = normalizeRows(Array.isArray(loaded) ? loaded : loaded.rows);
        if (!rows.length) return json({ error: 'No rows found.' }, 400);
        const findings = analyze(rows);
        if (loaded.queries) Object.assign(findings, analyzeQueries(loaded.queries));
        if (body.week) { const w = weekRange(body.week); body.period = `week of ${iso(w.start)} to ${iso(w.end)}, compared with the week before`; }
        let summary = null, aiError = null;
        if ((env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY) && body.writeSummary !== false) {
          try { summary = await callAI(env, SYSTEM_PROMPT, userPrompt(findings, body)); } catch (e) { aiError = e.message; }
        }
        return json({ findings, summary, aiError, period: body.period || null });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }
    return new Response('Not found', { status: 404 });
  },
};
