// "Connect YouTube": Google OAuth, the same flow as connecting Search Console
// or GA4. Tokens live in an encrypted, HttpOnly cookie (AES-GCM keyed from
// SESSION_SECRET), so no database is needed.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET.
// Google Cloud: enable "YouTube Data API v3" and "YouTube Analytics API";
// OAuth client redirect URI = https://<your-worker>/api/auth/callback

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
const COOKIE = 'sv_session';
const STATE_COOKIE = 'sv_oauth_state';
const enc = new TextEncoder(), dec = new TextDecoder();

export const oauthConfigured = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.SESSION_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(JSON.stringify(obj))));
  return b64u(iv) + '.' + b64u(ct);
}
async function unseal(env, token) {
  try {
    const [iv, ct] = token.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aesKey(env), unb64u(ct));
    return JSON.parse(dec.decode(pt));
  } catch { return null; }
}
function readCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const origin = (req) => new URL(req.url).origin;

// GET /api/auth/google → Google consent screen
export async function authStart(req, env) {
  if (!oauthConfigured(env)) return new Response('Google sign-in is not configured on this server. See README → Connect YouTube.', { status: 501 });
  const state = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: origin(req) + '/api/auth/callback',
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
  });
  return new Response(null, { status: 302, headers: { location: u.toString(), 'set-cookie': setCookie(STATE_COOKIE, state, 600) } });
}

// GET /api/auth/callback → exchange code, store tokens, back to the app
export async function authCallback(req, env) {
  const url = new URL(req.url);
  const back = (msg) => new Response(null, { status: 302, headers: { location: '/?connect=' + encodeURIComponent(msg) } });
  if (url.searchParams.get('error')) return back(url.searchParams.get('error'));
  if (!url.searchParams.get('state') || url.searchParams.get('state') !== readCookie(req, STATE_COOKIE)) return back('state_mismatch');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code'),
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: origin(req) + '/api/auth/callback',
      grant_type: 'authorization_code',
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) return back('token_error');
  const session = { at: t.access_token, rt: t.refresh_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  const h = new Headers({ location: '/?connect=ok' });
  h.append('set-cookie', setCookie(COOKIE, await seal(env, session), 60 * 60 * 24 * 60));
  h.append('set-cookie', setCookie(STATE_COOKIE, '', 0));
  return new Response(null, { status: 302, headers: h });
}

// POST /api/auth/logout
export async function authLogout(req, env) {
  const s = readCookie(req, COOKIE) && oauthConfigured(env) ? await unseal(env, readCookie(req, COOKIE)) : null;
  if (s?.rt) await fetch('https://oauth2.googleapis.com/revoke?token=' + s.rt, { method: 'POST' }).catch(() => {});
  return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'set-cookie': setCookie(COOKIE, '', 0) } });
}

// Returns { token, setCookie? } or null. Refreshes the access token when expired.
export async function getSession(req, env) {
  if (!oauthConfigured(env)) return null;
  const raw = readCookie(req, COOKIE);
  const s = raw && (await unseal(env, raw));
  if (!s) return null;
  if (Date.now() < s.exp) return { token: s.at };
  if (!s.rt) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: s.rt, grant_type: 'refresh_token' }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) return null;
  const next = { ...s, at: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  return { token: next.at, setCookie: setCookie(COOKIE, await seal(env, next), 60 * 60 * 24 * 60) };
}
