// Sign in with Google, users & roles, "Connect YouTube", and invite emails.
// Same setup as the Searchverse GSC/GA tool: one Google OAuth client, D1 for
// users/sessions, tokens encrypted with APP_SECRET.
//
//   /auth/login     → sign in (openid email profile)
//   /auth/youtube   → connect the Google account that owns the channel
//   /auth/mail      → admin connects their own mailbox (gmail.send) for invites
//   /auth/callback  → shared redirect URI for all three
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_SECRET.

const SCOPES = {
  login: 'openid email profile',
  youtube: 'openid email https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly',
  mail: 'openid email https://www.googleapis.com/auth/gmail.send',
};
const SESSION_COOKIE = 'svy_sid';
const SESSION_DAYS = 30;
const enc = new TextEncoder(), dec = new TextDecoder();
const now = () => Date.now();

export class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const redirect = (location, headers = {}) => new Response(null, { status: 302, headers: { location, ...headers } });

export const authConfigured = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_SECRET && env.DB);

// ── Crypto helpers ───────────────────────────────────────────
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomId = (n = 24) => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.APP_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text)));
  return b64u(iv) + '.' + b64u(ct);
}
export async function decrypt(env, value) {
  const [iv, ct] = String(value).split('.');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aesKey(env), unb64u(ct)));
}

function cookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
const setCookie = (value, maxAge) => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

// ── Users & access ───────────────────────────────────────────
// Who may sign in: ADMIN_EMAILS, users an admin added, anyone matching
// ALLOWED_EMAILS ("@company.com" or exact emails), or the very first user
// when no admin is configured.
async function admitUser(env, email, name, picture) {
  const DB = env.DB;
  const admins = list(env.ADMIN_EMAILS);
  let user = await DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    const count = (await DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
    const allowed = list(env.ALLOWED_EMAILS).some((a) => (a.startsWith('@') ? email.endsWith(a) : email === a));
    let role = null;
    if (admins.includes(email) || (!admins.length && count === 0)) role = 'admin';
    else if (allowed) role = 'member';
    if (!role) return null;
    await DB.prepare('INSERT INTO users (email, name, picture, role, created_at) VALUES (?, ?, ?, ?, ?)').bind(email, name, picture, role, now()).run();
    user = { email, role, disabled: 0 };
  } else if (admins.includes(email) && user.role !== 'admin') {
    await DB.prepare("UPDATE users SET role = 'admin' WHERE email = ?").bind(email).run();
  }
  if (user.disabled) return null;
  await DB.prepare('UPDATE users SET name = ?, picture = ?, last_login = ? WHERE email = ?').bind(name, picture, now(), email).run();
  return user;
}

export async function currentUser(req, env) {
  if (!authConfigured(env)) return null;
  const sid = cookie(req, SESSION_COOKIE);
  if (!sid) return null;
  const row = await env.DB.prepare(
    'SELECT u.email, u.name, u.picture, u.role FROM sessions s JOIN users u ON u.email = s.email WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0'
  ).bind(sid, now()).first();
  return row || null;
}

// ── OAuth flow ───────────────────────────────────────────────
export async function authStart(req, env, mode) {
  if (!authConfigured(env)) return new Response('Google sign-in is not set up on this server yet. Follow GO-LIVE-GUIDE.md, Part C and D.', { status: 501 });
  let email = null;
  if (mode !== 'login') {
    const user = await currentUser(req, env);
    if (!user) return redirect('/');
    if (mode === 'mail' && user.role !== 'admin') return redirect('/?notice=' + encodeURIComponent('Only admins can connect a mailbox.'));
    email = user.email;
  }
  const state = randomId(16);
  await env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(now() - 15 * 60e3).run();
  await env.DB.prepare('INSERT INTO oauth_states (state, mode, email, created_at) VALUES (?, ?, ?, ?)').bind(state, mode, email, now()).run();
  const origin = new URL(req.url).origin;
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: origin + '/auth/callback',
    response_type: 'code',
    scope: SCOPES[mode],
    state,
    ...(mode === 'login' ? { prompt: 'select_account' } : { access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true' }),
  });
  return redirect(u.toString());
}

function idTokenClaims(idToken) {
  try { return JSON.parse(dec.decode(unb64u(idToken.split('.')[1]))); } catch { return {}; }
}

export async function authCallback(req, env) {
  const url = new URL(req.url);
  const back = (msg) => redirect('/?notice=' + encodeURIComponent(msg));
  if (url.searchParams.get('error')) return back(url.searchParams.get('error') === 'access_denied' ? 'Google sign-in was cancelled or blocked. If you weren\'t asked to choose an account, ask the admin to add your email as a test user in Google Cloud.' : url.searchParams.get('error'));
  const state = url.searchParams.get('state');
  const st = state && (await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first());
  if (!st || now() - st.created_at > 15 * 60e3) return back('Sign-in link expired. Please try again.');
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: url.origin + '/auth/callback', grant_type: 'authorization_code',
    }),
  });
  const tok = await r.json();
  if (!r.ok || !tok.id_token) return back('Google sign-in failed. Please try again.');
  // The token came straight from Google over TLS, so its claims can be trusted.
  const claims = idTokenClaims(tok.id_token);
  const gEmail = String(claims.email || '').toLowerCase();
  if (!gEmail || claims.email_verified === false) return back('Your Google email is not verified.');

  if (st.mode === 'login') {
    const user = await admitUser(env, gEmail, claims.name || gEmail, claims.picture || '');
    if (!user) return back(`${gEmail} doesn't have access yet. Ask an admin to add you.`);
    const sid = randomId();
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
    await env.DB.prepare('INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)').bind(sid, gEmail, now() + SESSION_DAYS * 864e5).run();
    return redirect('/', { 'set-cookie': setCookie(sid, SESSION_DAYS * 86400) });
  }

  if (!tok.refresh_token) return back('Google did not return offline access. Please try connecting again.');
  const table = st.mode === 'youtube' ? 'yt_connections' : 'mail_senders';
  if (st.mode === 'mail' && !(tok.scope || '').includes('gmail.send')) return back('Please tick "Send email on your behalf" on the Google screen.');
  if (st.mode === 'youtube' && !(tok.scope || '').includes('youtube.readonly')) return back('Please tick both YouTube permissions on the Google screen.');
  await env.DB.prepare(
    `INSERT INTO ${table} (owner_email, google_email, refresh_token_enc, access_token_enc, access_expires, connected_at, expired) VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(owner_email) DO UPDATE SET google_email = excluded.google_email, refresh_token_enc = excluded.refresh_token_enc,
       access_token_enc = excluded.access_token_enc, access_expires = excluded.access_expires, connected_at = excluded.connected_at, expired = 0`
  ).bind(st.email, gEmail, await encrypt(env, tok.refresh_token), await encrypt(env, tok.access_token), now() + (tok.expires_in - 60) * 1000, now()).run();
  return back(st.mode === 'youtube' ? `✓ YouTube connected (${gEmail}).` : `✓ Invites will now be sent from ${gEmail}.`);
}

export async function logout(req, env) {
  const sid = cookie(req, SESSION_COOKIE);
  if (sid && env.DB) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0) });
}

// Access token for a stored connection, refreshing when needed. Testing-mode
// apps lose refresh tokens after 7 days; then the row is marked expired.
export async function tokenFor(env, table, ownerEmail) {
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE owner_email = ? AND expired = 0`).bind(ownerEmail).first();
  if (!row) return null;
  if (row.access_expires > now() && row.access_token_enc) return { token: await decrypt(env, row.access_token_enc), googleEmail: row.google_email, connectedAt: row.connected_at };
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: await decrypt(env, row.refresh_token_enc), grant_type: 'refresh_token' }),
  });
  const tk = await r.json();
  if (!r.ok || !tk.access_token) {
    if (tk.error === 'invalid_grant') await env.DB.prepare(`UPDATE ${table} SET expired = 1 WHERE owner_email = ?`).bind(ownerEmail).run();
    return null;
  }
  await env.DB.prepare(`UPDATE ${table} SET access_token_enc = ?, access_expires = ? WHERE owner_email = ?`)
    .bind(await encrypt(env, tk.access_token), now() + (tk.expires_in - 60) * 1000, ownerEmail).run();
  return { token: tk.access_token, googleEmail: row.google_email, connectedAt: row.connected_at };
}

export async function connectionStatus(env, table, ownerEmail) {
  const row = await env.DB.prepare(`SELECT google_email, connected_at, expired FROM ${table} WHERE owner_email = ?`).bind(ownerEmail).first();
  if (!row) return null;
  return { googleEmail: row.google_email, connectedAt: row.connected_at, expired: !!row.expired, expiresInDays: Math.max(0, Math.ceil((row.connected_at + 7 * 864e5 - now()) / 864e5)) };
}

export async function disconnect(env, table, ownerEmail) {
  const row = await env.DB.prepare(`SELECT refresh_token_enc FROM ${table} WHERE owner_email = ?`).bind(ownerEmail).first();
  if (row) {
    const rt = await decrypt(env, row.refresh_token_enc).catch(() => null);
    if (rt) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST' }).catch(() => {});
    await env.DB.prepare(`DELETE FROM ${table} WHERE owner_email = ?`).bind(ownerEmail).run();
  }
}

// ── Users admin ──────────────────────────────────────────────
export async function listUsers(env) {
  const { results } = await env.DB.prepare('SELECT email, name, picture, role, disabled, invited_by, last_login, created_at FROM users ORDER BY role, email').all();
  return results;
}
export async function addUser(env, by, email, role) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError('Enter a valid email address.');
  role = role === 'admin' ? 'admin' : 'member';
  await env.DB.prepare(
    'INSERT INTO users (email, name, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, disabled = 0'
  ).bind(email, email, role, by, now()).run();
  return email;
}
export async function updateUser(env, by, email, { role, disabled }) {
  if (email === by && (role === 'member' || disabled)) throw new HttpError("You can't remove your own admin access.");
  if (role) await env.DB.prepare('UPDATE users SET role = ? WHERE email = ?').bind(role === 'admin' ? 'admin' : 'member', email).run();
  if (disabled !== undefined) {
    await env.DB.prepare('UPDATE users SET disabled = ? WHERE email = ?').bind(disabled ? 1 : 0, email).run();
    if (disabled) await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run();
  }
}
export async function removeUser(env, by, email) {
  if (email === by) throw new HttpError("You can't remove yourself.");
  await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run();
  await env.DB.prepare('DELETE FROM yt_connections WHERE owner_email = ?').bind(email).run();
  await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email).run();
}

// ── Invite emails ────────────────────────────────────────────
// Order: the admin's own Gmail (gmail.send) → Brevo (free 300/day) → the
// browser opens the admin's mail app with the text ready (mailto).
export function inviteText(origin, inviter, role) {
  return {
    subject: `${inviter} invited you to Searchverse Channel Audit`,
    text: `Hi,\n\n${inviter} has invited you to Searchverse Channel Audit as ${role === 'admin' ? 'an admin' : 'a team member'}.\n\nHow to open it:\n1. Go to ${origin}\n2. Click "Sign in with Google"\n3. Choose this email address\n\nIf Google says "app not verified", click Continue: it's your team's internal tool.\n\nThanks`,
  };
}
const htmlOf = (t) => '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">' + t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>') + '</div>';

async function sendViaGmail(env, inviter, to, t) {
  const tk = await tokenFor(env, 'mail_senders', inviter);
  if (!tk) return { emailed: false };
  const mime = [
    `From: ${tk.googleEmail}`, `To: ${to}`, `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(t.subject)))}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', htmlOf(t.text),
  ].join('\r\n');
  const raw = b64u(enc.encode(mime));
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { authorization: 'Bearer ' + tk.token, 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
  });
  return r.ok ? { emailed: true, via: 'gmail', from: tk.googleEmail } : { emailed: false, reason: `Gmail ${r.status}` };
}

export async function sendInvite(env, origin, to, inviter, role) {
  const t = inviteText(origin, inviter, role);
  const g = await sendViaGmail(env, inviter, to, t).catch((e) => ({ emailed: false, reason: e.message }));
  if (g.emailed) return { ...g, ...t };
  if (env.BREVO_API_KEY && env.MAIL_FROM) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: env.MAIL_FROM, name: 'Searchverse' }, to: [{ email: to }], replyTo: { email: inviter }, subject: t.subject, textContent: t.text, htmlContent: htmlOf(t.text) }),
    });
    if (r.ok) return { emailed: true, via: 'brevo', from: env.MAIL_FROM, ...t };
  }
  return { emailed: false, ...t };
}
