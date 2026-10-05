import { analyzePage, opportunities, siteChecks, overallScores, missingSpots } from './analyzer.js';

const app = document.getElementById('app');
const state = { me: null };

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 0) => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (n, d = 1) => (n == null ? '–' : fmt(n * 100, d) + '%');
const date = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortUrl = (u) => { try { const x = new URL(u); return x.pathname + x.search || '/'; } catch { return u; } };
const scoreColor = (v) => (v >= 80 ? 'var(--good)' : v >= 55 ? 'var(--warn)' : 'var(--bad)');
const pillFor = (v) => (v >= 80 ? 'good' : v >= 55 ? 'warn' : 'bad');
const isAdmin = () => state.me?.user.role === 'admin';
const canRun = (p) => p.my_role === 'admin' || p.my_role === 'editor';
const accessPill = (r) => r === 'admin' ? '<span class="pill info">Admin</span>' : r === 'editor' ? '<span class="pill good">Can run analysis</span>' : '<span class="pill">View only</span>';
const ring = (v, big) => `<div class="ring ${big ? 'big' : ''}" style="--v:${v || 0};--c:${scoreColor(v)}"><span>${v ?? '–'}</span></div>`;
const mark = (v) => (v >= 1 ? '<span class="yes">✓</span>' : v > 0 ? '<span class="part">~</span>' : '<span class="no">✗</span>');

function delta(cur, prev, { invert = false, isPct = false } = {}) {
  if (cur == null || prev == null || prev === 0) return '';
  const diff = isPct ? (cur - prev) * 100 : ((cur - prev) / Math.abs(prev)) * 100;
  if (!isFinite(diff) || Math.abs(diff) < 0.05) return '<span class="delta muted">0%</span>';
  const good = invert ? diff < 0 : diff > 0;
  return `<span class="delta ${good ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff), 1)}${isPct ? 'pp' : '%'}</span>`;
}

function toast(msg, ms = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { state.me = null; route(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function hashParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

// Testing-mode Google apps expire refresh tokens 7 days after consent.
const TOKEN_DAYS = 7;
function connStatus(c) {
  const left = c.connected_at + TOKEN_DAYS * 86400000 - Date.now();
  if (c.expired || left <= 0) return { expired: true, days: 0, html: '<span class="pill bad">Expired — reconnect</span>' };
  const days = Math.ceil(left / 86400000);
  return { expired: false, days, html: `<span class="pill ${days <= 2 ? 'warn' : 'good'}">Active · expires in ${days} day${days > 1 ? 's' : ''}</span>` };
}
const reconnectBtn = (c, cls = 'btn sm primary') => `<a class="${cls}" href="/auth/connect?hint=${encodeURIComponent(c.google_email)}">Reconnect</a>`;

// ---------- charts ----------
function lineChart(series, { height = 180, labels = [] } = {}) {
  const W = 800, H = height, P = { l: 44, r: 10, t: 10, b: 22 };
  const n = Math.max(...series.map((s) => s.values.length));
  if (!n) return '<div class="muted small">No data</div>';
  const out = [];
  series.forEach((s) => {
    const max = Math.max(1, ...s.values) * 1.1;
    const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(1, n - 1);
    const y = (v) => P.t + (H - P.t - P.b) * (1 - v / max);
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    out.push(`<polyline fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="4 4"' : ''} points="${pts}"/>`);
    if (s.axis) {
      for (let k = 0; k <= 3; k++) {
        const v = (max / 3) * k;
        out.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/><text x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`);
      }
    }
  });
  const step = Math.ceil(labels.length / 8);
  labels.forEach((l, i) => {
    if (i % step === 0) out.push(`<text x="${P.l + (i * (W - P.l - P.r)) / Math.max(1, n - 1)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`);
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">${out.join('')}</svg></div>
    <div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

// ---------- sortable table ----------
let tableSeq = 0;
function table(cols, rows, { onRow, filter = true, limit = 300, empty = 'Nothing here 🎉' } = {}) {
  const tid = 't' + ++tableSeq;
  const st = { key: null, dir: -1, q: '' };
  const html = () => {
    let r = rows;
    if (st.q) r = r.filter((x) => cols.some((c) => String(c.text ? c.text(x) : x[c.key] ?? '').toLowerCase().includes(st.q)));
    if (st.key) {
      const c = cols.find((c) => c.key === st.key);
      const val = c.sort || ((x) => x[c.key]);
      r = [...r].sort((a, b) => { const A = val(a), B = val(b); return (A > B ? 1 : A < B ? -1 : 0) * st.dir; });
    }
    if (!r.length) return `<tr><td colspan="${cols.length}" class="muted">${empty}</td></tr>`;
    return r.slice(0, limit).map((x) => `<tr class="${onRow ? 'click' : ''}" data-i="${rows.indexOf(x)}">${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(x) : esc(x[c.key])}</td>`).join('')}</tr>`).join('');
  };
  setTimeout(() => {
    const el = document.getElementById(tid);
    if (!el) return;
    const body = el.querySelector('tbody');
    el.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.k;
      st.dir = st.key === k ? -st.dir : -1;
      st.key = k;
      body.innerHTML = html();
    }));
    el.querySelector('input')?.addEventListener('input', (e) => { st.q = e.target.value.toLowerCase(); body.innerHTML = html(); });
    if (onRow) body.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr && !e.target.closest('a')) onRow(rows[tr.dataset.i]); });
  });
  return `<div id="${tid}">${filter && rows.length > 8 ? `<input class="filter" placeholder="Filter…" style="margin-bottom:10px">` : ''}
    <div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th data-k="${c.key}" class="${c.num ? 'num' : ''}">${c.label} ↕</th>`).join('')}</tr></thead>
    <tbody>${html()}</tbody></table></div>${rows.length > limit ? `<div class="muted small">Showing first ${limit} of ${rows.length}</div>` : ''}</div>`;
}

const urlCell = (u) => `<a class="url" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(u)}">${esc(shortUrl(u))}</a>`;

// ---------- drawer ----------
function openDrawer(html) {
  document.getElementById('drawer-panel').innerHTML = `<div class="row spread"><span></span><button class="btn sm" data-close>Close ✕</button></div>${html}`;
  document.getElementById('drawer').classList.remove('hidden');
}
document.getElementById('drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) document.getElementById('drawer').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('drawer').classList.add('hidden'); });

// ---------- nav / router ----------
function renderNav() {
  const nav = document.getElementById('nav');
  if (!state.me) { nav.innerHTML = ''; return; }
  const u = state.me.user;
  nav.innerHTML = `<a href="#/">Projects</a>${isAdmin() ? '<a href="#/users">Users</a>' : ''}<a href="#/settings">Settings</a>
    <span class="row" style="gap:8px">${u.picture ? `<img class="avatar" src="${esc(u.picture)}" referrerpolicy="no-referrer">` : ''}<span class="hide-sm small muted">${esc(u.email)}</span></span>
    <a href="/auth/logout" class="btn sm">Sign out</a>`;
}

async function route() {
  document.getElementById('drawer').classList.add('hidden');
  if (!state.me) {
    try { const me = await fetch('/api/me').then((r) => r.json()); state.me = me.user ? me : null; } catch { state.me = null; }
  }
  renderNav();
  const p = hashParams();
  const err = p.error ? `<div class="banner err">${esc(p.error)}</div>` : '';
  if (!state.me) return renderLogin(err);
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  let m;
  try {
    if (path === '/') return await renderHome(err);
    if (path === '/settings') return await renderSettings(err, p);
    if (['/new', '/users'].includes(path) || /\/edit$/.test(path)) {
      if (!isAdmin()) { app.innerHTML = '<div class="banner err">Only admins can open this page.</div>'; return; }
    }
    if (path === '/users') return await renderUsers(err);
    if (path === '/new') return await renderProjectForm(null);
    if ((m = path.match(/^\/p\/(\w+)\/edit$/))) return await renderProjectForm(m[1]);
    if ((m = path.match(/^\/p\/(\w+)\/run$/))) return await renderRunner(m[1]);
    if ((m = path.match(/^\/p\/(\w+)$/))) return await renderProject(m[1], p.run);
    app.innerHTML = '<div class="center">Not found</div>';
  } catch (e) {
    app.innerHTML = `<div class="banner err">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- login ----------
function renderLogin(err) {
  const feat = (icon, t, d) => `<div class="feat"><div class="feat-icon">${icon}</div><b>${t}</b><p>${d}</p></div>`;
  app.innerHTML = `${err}<div class="hero">
    <div class="hero-badge">Search Console · GA4 · Gemini AI</div>
    <h1>Searchverse <span class="grad">GA &amp; GSC Connectors</span></h1>
    <p class="muted lead">Connect Google Search Console and GA4, crawl your key pages and get a professional SEO score with clear, prioritised recommendations. Every project's history is saved.</p>
    <p style="margin-top:28px"><a class="btn primary lg" href="/auth/login">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Sign in with Google</a></p>
    <p class="small muted">Access is by invitation. Ask your admin to add your email.</p>
  </div>
  <div class="feats">
    ${feat('🎯', 'SEO score', 'Overall, on-page, content and technical scores, weighted by real impressions.')}
    ${feat('🔎', 'Query coverage', 'Checks whether each page targets the queries it ranks for: title, H1, headings, copy and how often they appear.')}
    ${feat('🚀', 'Opportunities', 'Striking-distance keywords, low-CTR snippets, cannibalisation and declining pages.')}
    ${feat('🤖', 'AI recommendations', 'Gemini writes the action plan: new titles, metas, content gaps and quick wins.')}
  </div>`;
}

// ---------- home ----------
async function renderHome(err) {
  const [{ projects }, { connections }] = await Promise.all([api('/api/projects'), isAdmin() ? api('/api/connections') : { connections: null }]);
  if (!connections) {
    app.innerHTML = `${err}<h1>Projects</h1>
      <div class="grid g3 section">${projects.map(projectCard).join('') || '<div class="card muted">No projects shared with you yet. Ask your admin for access.</div>'}</div>`;
    return;
  }
  const steps = [
    { done: connections.length > 0, t: 'Connect the Google account that has Search Console / GA4 access', href: '#/settings', cta: 'Connect' },
    { done: projects.length > 0, t: 'Create your first project', href: '#/new', cta: 'Create' },
    { done: projects.some((p) => p.last_run), t: 'Run the first analysis', href: projects[0] ? `#/p/${projects[0].id}/run` : '#/new', cta: 'Run' },
    { done: false, t: 'Invite your team by email (optional)', href: '#/users', cta: 'Invite', optional: true },
  ];
  const noConn = steps.slice(0, 3).some((x) => !x.done)
    ? `<div class="card onboard"><h2>Get started</h2>${steps.map((x, i) => `<div class="ostep ${x.done ? 'done' : ''}"><span class="onum">${x.done ? '✓' : i + 1}</span><span style="flex:1">${x.t}</span>${x.done ? '' : `<a class="btn sm ${x.optional ? '' : 'primary'}" href="${x.href}">${x.cta}</a>`}</div>`).join('')}</div>` : '';
  const stale = connections.filter((c) => connStatus(c).expired || connStatus(c).days <= 1);
  const expBanner = stale.length ? `<div class="banner err">⏳ Google access ${stale.length > 1 ? 'needs' : 'needs'} a refresh for ${stale.map((c) => `<b>${esc(c.google_email)}</b> ${reconnectBtn(c)}`).join(' ')} — takes 10 seconds.</div>` : '';
  app.innerHTML = `${err}${noConn}${expBanner}
    <div class="row spread"><h1>Projects</h1><a class="btn primary" href="#/new">+ New project</a></div>
    <div class="grid g3 section">${projects.map(projectCard).join('') || '<div class="muted">No projects yet. Create one to get started.</div>'}
    </div>`;
}

function projectCard(p) {
  return `
      <a class="card click" href="#/p/${p.id}" style="color:inherit;text-decoration:none">
        <div class="row spread"><div style="min-width:0"><h3 style="margin:0">${esc(p.name)}</h3><div class="muted small url">${esc(p.gsc_property)}</div></div>${ring(p.last_score)}</div>
        <div class="row small muted" style="margin-top:12px;gap:16px">
          <span>Clicks <b style="color:var(--text)">${fmt(p.kpis?.clicks)}</b></span>
          <span>Impr. <b style="color:var(--text)">${fmt(p.kpis?.impressions)}</b></span>
          <span>${p.last_run ? 'Last run ' + new Date(p.last_run).toLocaleDateString() : 'Never analysed'}</span>
        </div>
        ${p.my_role !== 'admin' ? `<div style="margin-top:8px">${accessPill(p.my_role)}</div>` : ''}
      </a>`;
}

// ---------- settings ----------
async function renderSettings(err, p) {
  const me = state.me;
  const { connections } = isAdmin() ? await api('/api/connections') : { connections: null };
  app.innerHTML = `${err}${p.connected ? `<div class="banner">✅ Connected <b>${esc(p.connected)}</b>. You can now use its Search Console / GA4 properties in projects.</div>` : ''}
    <h1>Settings</h1>
    <div class="grid g2 section">
      ${connections ? `<div class="card">
        <h2>Google data accounts</h2>
        <p class="muted small">You're signed in as <b>${esc(me.user.email)}</b>. If GSC / GA4 access lives on a different Google account (e.g. a client or personal Gmail), connect that account here — read-only access. You can connect as many as you need.</p>
        ${connections.map((c) => `<div class="check"><div style="flex:1"><b>${esc(c.google_email)}</b>
            <div class="small muted">${c.scopes?.includes('webmasters') ? 'Search Console ✓' : 'Search Console ✗'} · ${c.scopes?.includes('analytics') ? 'Analytics ✓' : 'Analytics ✗'} · last connected ${new Date(c.connected_at).toLocaleDateString()}</div>
            <div style="margin-top:4px">${connStatus(c).html}</div></div>
            <div class="row" style="gap:6px">${reconnectBtn(c, connStatus(c).days <= 2 ? 'btn sm primary' : 'btn sm')}<button class="btn sm danger" data-del="${c.id}">Remove</button></div></div>`).join('') || '<p class="muted">No accounts connected yet.</p>'}
        <p><a class="btn primary" href="/auth/connect">+ Connect a Google account</a></p>
        <p class="hint">Tip: on Google's screen pick the account that owns the properties and tick both permission boxes. While the Google app is in testing mode, access lasts 7 days. Click <b>Reconnect</b> when it expires. Your projects and history are kept.</p>
      </div>` : `<div class="card"><h2>Your access</h2><p>You're a <b>member</b>. An admin manages Google connections, projects and who can see what.</p><p class="muted small">Ask your admin if you need access to another project or permission to run analyses.</p></div>`}
      <div class="card">
        <h2>Gemini AI key</h2>
        <p class="muted small">AI recommendations use Google Gemini's free tier. Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Stored encrypted on the server.</p>
        <p>Status: ${me.user.hasGeminiKey ? '<span class="pill good">Your key is saved</span>' : me.serverGeminiKey ? '<span class="pill info">Using the shared server key</span>' : '<span class="pill bad">No key yet</span>'}</p>
        <label>API key</label><input id="gkey" type="password" placeholder="AIza…" autocomplete="off">
        <div class="row" style="margin-top:12px"><button class="btn primary" id="savekey">Save key</button>${me.user.hasGeminiKey ? '<button class="btn danger" id="clearkey">Remove my key</button>' : ''}</div>
      </div>
    </div>`;
  app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this Google account? Projects using it will stop updating until you pick another account.')) return;
    await api('/api/connections/' + b.dataset.del, { method: 'DELETE' });
    route();
  });
  const saveKey = async (geminiKey) => { await api('/api/settings', { method: 'PUT', body: { geminiKey } }); state.me = null; toast('Saved'); location.hash = '#/settings'; route(); };
  document.getElementById('savekey').onclick = () => { const v = document.getElementById('gkey').value.trim(); if (v) saveKey(v); };
  document.getElementById('clearkey')?.addEventListener('click', () => saveKey(''));
}

// ---------- users (admin) ----------
async function renderUsers(err) {
  const [{ users }, { projects }] = await Promise.all([api('/api/users'), api('/api/projects')]);
  const me = state.me.user.email;
  app.innerHTML = `${err}<div class="row spread"><div><h1>Users</h1><div class="muted small">Admins have full access. Members only see the projects you give them.</div></div>
      <button class="btn primary" id="u-add">+ Add user</button></div>
    <div class="card section">${table([
      { key: 'email', label: 'User', render: (u) => `<div class="row" style="gap:8px;flex-wrap:nowrap">${u.picture ? `<img class="avatar" src="${esc(u.picture)}" referrerpolicy="no-referrer">` : ''}<div><b>${esc(u.name && u.name !== u.email ? u.name : u.email)}</b>${u.email === me ? ' <span class="pill">you</span>' : ''}<div class="small muted">${esc(u.email)}</div></div></div>` },
      { key: 'role', label: 'Role', render: (u) => (u.role === 'admin' ? '<span class="pill info">Admin</span>' : '<span class="pill">Member</span>') },
      { key: 'access', label: 'Project access', render: (u) => (u.role === 'admin' ? '<span class="muted small">All projects</span>' : u.projects.map((p) => `<div class="small">${esc(p.name)} · ${p.role === 'editor' ? 'can run' : 'view only'}</div>`).join('') || '<span class="muted small">None</span>') },
      { key: 'status', label: 'Status', render: (u) => (u.disabled ? '<span class="pill bad">Disabled</span>' : u.last_login ? '<span class="pill good">Active</span>' : '<span class="pill warn">Invited</span>') },
      { key: 'last_login', label: 'Last sign-in', render: (u) => (u.last_login ? date(u.last_login) : '–') },
    ], users, { onRow: (u) => userEditor(u, projects) })}<p class="hint">Click a user to edit their role or project access. Added users sign in with the Google account for that email.</p></div>`;
  document.getElementById('u-add').onclick = () => userEditor(null, projects);
}

function userEditor(u, projects) {
  const isNew = !u;
  u = u || { email: '', role: 'member', disabled: 0, projects: [] };
  const access = Object.fromEntries(u.projects.map((p) => [p.id, p.role]));
  openDrawer(`<h2>${isNew ? 'Add user' : esc(u.email)}</h2>
    ${isNew ? '<label>Email (their Google account)</label><input id="ue-email" placeholder="name@company.com">' : ''}
    <label>Role</label>
    <select id="ue-role"><option value="member" ${u.role === 'member' ? 'selected' : ''}>Member — limited access</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin — full access</option></select>
    <div class="hint">Admins do the setup: connect Google accounts, create/edit/delete projects, manage users. Members can open their projects and run analyses, but can't change any setup.</div>
    <div id="ue-proj" class="${u.role === 'admin' ? 'hidden' : ''}">
      <label>Project access</label>
      ${projects.map((p) => `<div class="check" style="align-items:center"><div style="flex:1"><b>${esc(p.name)}</b><div class="small muted">${esc(p.gsc_property)}</div></div>
        <select data-pid="${p.id}" style="width:auto"><option value="">No access</option><option value="editor" ${access[p.id] === 'editor' ? 'selected' : ''}>Can run analysis</option><option value="viewer" ${access[p.id] === 'viewer' ? 'selected' : ''}>View only</option></select></div>`).join('') || '<p class="muted">No projects yet.</p>'}
    </div>
    ${isNew ? '' : `<label><input type="checkbox" id="ue-dis" style="width:auto" ${u.disabled ? 'checked' : ''}> Disable sign-in (keeps their settings)</label>`}
    <div class="row" style="margin-top:20px"><button class="btn primary" id="ue-save">${isNew ? 'Add user' : 'Save'}</button>${isNew ? '' : '<button class="btn danger" id="ue-del">Remove user</button>'}</div>`);
  const role = document.getElementById('ue-role');
  role.onchange = () => document.getElementById('ue-proj').classList.toggle('hidden', role.value === 'admin');
  document.getElementById('ue-save').onclick = async () => {
    const projectsSel = [...document.querySelectorAll('[data-pid]')].filter((s) => s.value).map((s) => ({ id: s.dataset.pid, role: s.value }));
    const b = { role: role.value, projects: role.value === 'admin' ? [] : projectsSel };
    try {
      if (isNew) await api('/api/users', { method: 'POST', body: { ...b, email: document.getElementById('ue-email').value } });
      else await api('/api/users/' + encodeURIComponent(u.email), { method: 'PUT', body: { ...b, disabled: document.getElementById('ue-dis').checked } });
      toast('Saved');
      route();
    } catch (e) { toast(e.message); }
  };
  document.getElementById('ue-del')?.addEventListener('click', async () => {
    if (!confirm(`Remove ${u.email}? They will lose access immediately.`)) return;
    try { await api('/api/users/' + encodeURIComponent(u.email), { method: 'DELETE' }); route(); } catch (e) { toast(e.message); }
  });
}

// ---------- project form ----------
async function renderProjectForm(pid) {
  const { connections } = await api('/api/connections');
  if (!connections.length) { location.hash = '#/settings'; return toast('Connect a Google account first'); }
  const p = pid ? (await api('/api/projects/' + pid)).project : { max_pages: 25 };
  const isOwner = isAdmin();
  app.innerHTML = `<div class="row spread"><h1>${pid ? 'Edit project' : 'New project'}</h1><a class="btn" href="${pid ? '#/p/' + pid : '#/'}">Cancel</a></div>
    <div class="grid g2 section">
      <div class="card">
        <label>Project name</label><input id="f-name" value="${esc(p.name || '')}" placeholder="e.g. Acme – India">
        <label>Google account with access</label>
        <select id="f-conn">${connections.map((c) => `<option value="${c.id}" ${c.id === p.connection_id ? 'selected' : ''}>${esc(c.google_email)}</option>`).join('')}</select>
        <label>Search Console property</label><select id="f-gsc"><option>Loading…</option></select>
        <label>GA4 property <span class="muted">(optional)</span></label><select id="f-ga"><option value="">Loading…</option></select>
        <div id="prop-err" class="hint"></div>
        <label>Homepage URL</label><input id="f-site" value="${esc(p.site_url || '')}" placeholder="Auto from Search Console property">
        <div class="hint">Used for crawling and robots.txt / sitemap checks.</div>
        <label>Pages to crawl per run</label><input id="f-max" type="number" min="5" max="100" value="${p.max_pages || 25}">
        <div class="hint">Top pages by clicks & impressions from Search Console (5–100).</div>
        <div class="row" style="margin-top:20px"><button class="btn primary" id="f-save" ${isOwner ? '' : 'disabled'}>${pid ? 'Save changes' : 'Create project'}</button>
        ${pid && isOwner ? '<button class="btn danger" id="f-del">Delete project</button>' : ''}</div>
      </div>
      ${pid ? `<div class="card"><h2>Team access</h2>
        <p class="muted small">Admins see every project. Members only see the projects you add them to: <b>View only</b> lets them see results, and <b>Can run analysis</b> also lets them run new analyses. Members sign in with their own Google account.</p>
        ${(p.members || []).map((m) => `<div class="check"><div style="flex:1">${esc(m.email)}<div>${accessPill(m.role)}</div></div><button class="btn sm danger" data-rm="${esc(m.email)}">Remove</button></div>`).join('') || '<p class="muted">No members yet. Only admins can see this project.</p>'}
        <div class="row" style="margin-top:12px"><input id="m-email" placeholder="colleague@company.com" style="flex:1"><select id="m-role" style="width:auto"><option value="editor">Can run analysis</option><option value="viewer">View only</option></select><button class="btn" id="m-add">Add</button></div>
      </div>` : ''}
    </div>`;

  const load = async () => {
    const gsc = document.getElementById('f-gsc'), ga = document.getElementById('f-ga');
    gsc.innerHTML = '<option>Loading…</option>'; ga.innerHTML = '<option value="">Loading…</option>';
    try {
      const r = await api(`/api/connections/${document.getElementById('f-conn').value}/properties`);
      gsc.innerHTML = r.gsc.map((s) => `<option value="${esc(s.url)}" ${s.url === p.gsc_property ? 'selected' : ''}>${esc(s.url)}</option>`).join('') || '<option value="">No Search Console properties on this account</option>';
      ga.innerHTML = '<option value="">— None —</option>' + r.ga4.map((g) => `<option value="${esc(g.id)}" ${g.id === p.ga4_property ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
      document.getElementById('prop-err').textContent = [r.errors.gsc && 'Search Console: ' + r.errors.gsc, r.errors.ga4 && 'GA4: ' + r.errors.ga4].filter(Boolean).join(' · ');
      if (!pid && !document.getElementById('f-name').value && gsc.value) document.getElementById('f-name').value = gsc.value.replace(/^sc-domain:|^https?:\/\/|\/$/g, '');
    } catch (e) { document.getElementById('prop-err').textContent = e.message; }
  };
  document.getElementById('f-conn').onchange = load;
  load();

  document.getElementById('f-save').onclick = async () => {
    const ga = document.getElementById('f-ga');
    const b = {
      name: document.getElementById('f-name').value, connection_id: document.getElementById('f-conn').value,
      gsc_property: document.getElementById('f-gsc').value, ga4_property: ga.value, ga4_name: ga.value ? ga.selectedOptions[0].textContent : '',
      site_url: document.getElementById('f-site').value, max_pages: document.getElementById('f-max').value,
    };
    try {
      if (pid) { await api('/api/projects/' + pid, { method: 'PUT', body: b }); location.hash = '#/p/' + pid; }
      else { const r = await api('/api/projects', { method: 'POST', body: b }); location.hash = `#/p/${r.id}/run`; }
    } catch (e) { toast(e.message); }
  };
  document.getElementById('f-del')?.addEventListener('click', async () => {
    if (!confirm('Delete this project and all its history?')) return;
    await api('/api/projects/' + pid, { method: 'DELETE' }); location.hash = '#/';
  });
  document.getElementById('m-add')?.addEventListener('click', async () => {
    try { await api(`/api/projects/${pid}/members`, { method: 'POST', body: { email: document.getElementById('m-email').value, role: document.getElementById('m-role').value } }); route(); } catch (e) { toast(e.message); }
  });
  app.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => { await api(`/api/projects/${pid}/members`, { method: 'DELETE', body: { email: b.dataset.rm } }); route(); });
}

// ---------- runner ----------
async function renderRunner(pid) {
  const { project } = await api('/api/projects/' + pid);
  if (!canRun(project)) { app.innerHTML = '<div class="banner err">You have view-only access to this project.</div>'; return; }
  app.innerHTML = `<div class="row spread"><div><h1>Run analysis</h1><div class="muted">${esc(project.name)} · ${esc(project.gsc_property)}</div></div><a class="btn" href="#/p/${pid}">Back</a></div>
    <div class="card section" id="setup">
      <div class="row" style="align-items:flex-end">
        <div><label style="margin-top:0">Date range</label><select id="r-days"><option value="28" selected>Last 28 days vs previous</option><option value="7">Last 7 days vs previous</option><option value="90">Last 90 days vs previous</option></select></div>
        <div><label style="margin-top:0">Pages to crawl</label><input id="r-max" type="number" min="5" max="100" value="${project.max_pages}" style="width:110px"></div>
        <button class="btn primary" id="r-go">▶ Start analysis</button>
      </div>
      <p class="hint">Pulls Search Console${project.ga4_property ? ' + GA4' : ''}, crawls your top pages, scores them and asks Gemini for recommendations. Takes 1–3 minutes — keep this tab open.</p>
    </div>
    <div class="card section hidden" id="prog"><h2 id="p-step">Starting…</h2><div class="progress"><div id="p-bar" style="width:2%"></div></div><div class="log" id="p-log"></div></div>`;
  document.getElementById('r-go').onclick = () => runAnalysis(project, +document.getElementById('r-days').value, +document.getElementById('r-max').value);
}

async function runAnalysis(project, days, maxPages) {
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('prog').classList.remove('hidden');
  const logEl = document.getElementById('p-log');
  const log = (m, cls = '') => { logEl.insertAdjacentHTML('beforeend', `<div class="${cls}">${esc(m)}</div>`); logEl.scrollTop = 1e9; };
  const step = (m, p) => { document.getElementById('p-step').textContent = m; document.getElementById('p-bar').style.width = p + '%'; log('› ' + m); };
  let run;
  try {
    step('Creating run', 3);
    run = (await api(`/api/projects/${project.id}/runs`, { method: 'POST', body: { days } })).run;
    log(`Period ${run.start} → ${run.end} (compared with ${run.pstart} → ${run.pend})`);

    step('Fetching Search Console data', 8);
    const { gsc } = await api(`/api/runs/${run.id}/gsc`, { method: 'POST' });
    log(`${fmt(gsc.totals.clicks)} clicks, ${fmt(gsc.totals.impressions)} impressions, ${gsc.queries.length} queries, ${gsc.pages.length} pages`);

    let ga = null;
    if (project.ga4_property) {
      step('Fetching GA4 data', 14);
      try { ga = (await api(`/api/runs/${run.id}/ga`, { method: 'POST' })).ga; log(`${ga.landing.length} organic landing pages`); }
      catch (e) { log('GA4 skipped: ' + e.message, 'no'); }
    }

    // pick pages: homepage + top by clicks, then by impressions
    const urls = [project.site_url];
    const add = (u) => { if (!urls.includes(u) && urls.length < maxPages) urls.push(u); };
    [...gsc.pages].sort((a, b) => b.c - a.c).slice(0, Math.ceil(maxPages * 0.6)).forEach((p) => add(p.u));
    [...gsc.pages].sort((a, b) => b.i - a.i).forEach((p) => add(p.u));

    const fetchUrl = (u) => api(`/api/projects/${project.id}/fetch?url=${encodeURIComponent(u)}`).catch((e) => ({ url: u, finalUrl: u, status: 0, error: e.message, redirects: [], html: '' }));
    step('Checking robots.txt & sitemap', 18);
    const origin = new URL(project.site_url).origin;
    const robots = await fetchUrl(origin + '/robots.txt');
    const smUrl = (robots.html || '').match(/^\s*sitemap:\s*(\S+)/im)?.[1] || origin + '/sitemap.xml';
    const sitemap = await fetchUrl(smUrl);

    const pqByPage = {};
    for (const r of gsc.pageQueries) (pqByPage[r.u] ||= []).push(r);
    const gscPage = Object.fromEntries(gsc.pages.map((p) => [p.u, p]));
    const gaByPath = {};
    for (const l of ga?.landing || []) gaByPath[l.path.split('?')[0]] = l;

    const pages = [];
    let done = 0;
    const worker = async () => {
      while (urls.length) {
        const u = urls.shift();
        const f = await fetchUrl(u);
        let path = '/'; try { path = new URL(u).pathname; } catch {}
        const res = analyzePage(f, pqByPage[u] || [], gaByPath[path] || null);
        res.gsc = gscPage[u] || null;
        pages.push(res);
        done++;
        step(`Crawling pages (${done}/${done + urls.length})`, 20 + (done / (done + urls.length)) * 55);
        log(`${f.status} ${shortUrl(u)} — on-page ${res.onpage_score}, content ${res.content_score}`, f.status === 200 ? '' : 'no');
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    step('Scoring & finding opportunities', 78);
    const site = siteChecks(pages, robots, sitemap, project.site_url);
    const scores = overallScores(pages, site);
    const opps = opportunities(gsc, ga, pages);
    const organic = ga?.channels.find((c) => c.name === 'Organic Search');
    const summary = {
      days, scores, site, opps,
      kpis: {
        clicks: gsc.totals.clicks, impressions: gsc.totals.impressions, ctr: gsc.totals.ctr, position: gsc.totals.position,
        prev: gsc.prevTotals, sessions: organic?.cur?.sessions ?? null, prevSessions: organic?.prev?.sessions ?? null,
        keyEvents: organic?.cur?.keyEvents ?? null, prevKeyEvents: organic?.prev?.keyEvents ?? null,
        engagementRate: organic?.cur?.engagementRate ?? null,
      },
      pagesCrawled: pages.length,
    };

    step('Saving results', 82);
    for (let i = 0; i < pages.length; i += 10) await api(`/api/runs/${run.id}/pages`, { method: 'POST', body: { pages: pages.slice(i, i + 10) } });
    await api(`/api/runs/${run.id}/finish`, { method: 'POST', body: { score: scores.overall, summary } });
    log(`Overall score ${scores.overall} (on-page ${scores.onpage}, content ${scores.content}, technical ${scores.technical})`);

    step('Asking Gemini for recommendations', 88);
    try { await requestAi(run.id, { project, gsc, ga, pages, summary }); log('AI recommendations ready'); }
    catch (e) { log('AI step failed: ' + e.message + ' — you can retry from the Insights tab.', 'no'); }

    step('Done!', 100);
    setTimeout(() => (location.hash = `#/p/${project.id}?run=${run.id}`), 700);
  } catch (e) {
    log('Error: ' + e.message, 'no');
    document.getElementById('p-step').innerHTML = /expired/i.test(e.message)
      ? `Google access expired — <a class="btn sm primary" href="/auth/connect">Reconnect</a> then run again`
      : 'Analysis failed';
    if (run) api(`/api/runs/${run.id}/finish`, { method: 'POST', body: { error: e.message, summary: {} } }).catch(() => {});
  }
}

function aiInput({ project, gsc, ga, pages, summary }) {
  const k = summary.kpis;
  return {
    site: project.site_url,
    period: `last ${summary.days} days vs previous ${summary.days}`,
    kpis: { clicks: k.clicks, prevClicks: k.prev?.clicks, impressions: k.impressions, prevImpressions: k.prev?.impressions, ctr: +(k.ctr * 100).toFixed(2), avgPosition: +k.position.toFixed(1), organicSessions: k.sessions, prevOrganicSessions: k.prevSessions, keyEvents: k.keyEvents },
    scores: summary.scores,
    siteChecks: summary.site.checks.filter((c) => c.val < 1).map((c) => `${c.label}: ${c.detail}`),
    topQueries: gsc.queries.slice(0, 40).map((q) => [q.q, q.c, q.i, q.p]),
    queryFormat: '[query, clicks, impressions, position]',
    quickWins: summary.opps.quickWins.slice(0, 12).map((q) => ({ q: q.q, i: q.i, pos: q.p, ctr: q.ctr, page: q.page })),
    lowCtr: summary.opps.lowCtr.slice(0, 8).map((q) => ({ q: q.q, pos: q.p, ctr: q.ctr, expected: q.expected, page: q.page })),
    cannibalization: summary.opps.cannibalization.slice(0, 6),
    decliningPages: summary.opps.decliningPages.slice(0, 8).map((p) => ({ url: p.u, clicks: p.c, prevClicks: p.prevC, pos: p.p, prevPos: p.prevP })),
    risingQueries: summary.opps.risingQueries.slice(0, 8).map((q) => [q.q, q.c, q.prevC]),
    lowEngagementLanding: summary.opps.lowEngagement.slice(0, 6),
    devices: gsc.devices,
    pages: pages.slice(0, 30).map((p) => ({
      url: p.url, status: p.status, onpage: p.onpage_score, content: p.content_score, clicks: p.gsc?.c, impressions: p.gsc?.i, pos: p.gsc?.p,
      title: p.meta?.title, description: p.meta?.description, h1: p.meta?.h1s?.[0], words: p.meta?.wordCount, schema: p.meta?.schemaTypes,
      failed: p.checks.filter((c) => c.val < 1).map((c) => c.label + (c.detail ? ` (${c.detail})` : '')).slice(0, 10),
      topQueries: (p.queries || []).slice(0, 6).map((q) => ({ q: q.query, i: q.impressions, pos: q.position, score: q.score, missingIn: missingSpots(q) })),
      ga: p.ga ? { sessions: p.ga.sessions, engagementRate: p.ga.engagementRate, keyEvents: p.ga.keyEvents } : undefined,
    })),
  };
}

async function requestAi(runId, ctx) {
  return (await api(`/api/runs/${runId}/ai`, { method: 'POST', body: { input: aiInput(ctx) } })).ai;
}

// ---------- project dashboard ----------
async function renderProject(pid, runId) {
  const [{ project }, { runs }] = await Promise.all([api('/api/projects/' + pid), api(`/api/projects/${pid}/runs`)]);
  const done = runs.filter((r) => r.status === 'done');
  const head = `<div class="row spread"><div><h1>${esc(project.name)}</h1>
      <div class="muted small">${esc(project.gsc_property)}${project.ga4_name ? ' · GA4: ' + esc(project.ga4_name) : ''} · via ${esc(project.connection_email || '—')}</div></div>
      <div class="row">${done.length ? `<select id="run-pick" style="width:auto">${done.map((r) => `<option value="${r.id}">${date(r.created_at)} · score ${r.score}</option>`).join('')}</select>` : ''}
      ${isAdmin() ? `<a class="btn" href="#/p/${pid}/edit">Settings</a>` : accessPill(project.my_role)}${canRun(project) ? `<a class="btn primary" href="#/p/${pid}/run">▶ Run analysis</a>` : ''}</div></div>`;
  if (!done.length) {
    app.innerHTML = head + `<div class="card section center"><h2>No analysis yet</h2><p class="muted">${canRun(project) ? 'Run your first analysis to see scores, opportunities and AI recommendations.' : 'No analysis has been run yet. Ask someone with "Can run analysis" access to run one.'}</p>${canRun(project) ? `<a class="btn primary" href="#/p/${pid}/run">▶ Run analysis</a>` : ''}</div>`;
    return;
  }
  const rid = runId && done.find((r) => r.id === runId) ? runId : done[0].id;
  app.innerHTML = head + '<div class="center muted">Loading run…</div>';
  const data = await api('/api/runs/' + rid);
  const pick = document.getElementById('run-pick');
  pick.value = rid;
  pick.onchange = () => (location.hash = `#/p/${pid}?run=${pick.value}`);
  renderRun(project, data, done, head);
}

function renderRun(project, { run, pages }, runs, head) {
  const s = run.summary, k = s.kpis, gsc = run.gsc, ga = run.ga;
  pages.sort((a, b) => (b.gsc?.c || 0) - (a.gsc?.c || 0) || (b.gsc?.i || 0) - (a.gsc?.i || 0));
  const kpi = (label, v, d) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${v}</div>${d || '<span class="delta muted">&nbsp;</span>'}</div>`;
  const tabs = ['Insights', 'Opportunities', 'Pages', 'Queries', 'Technical', 'Traffic', 'History'];
  app.innerHTML = head + `
    <div class="muted small" style="margin-top:6px">Data ${run.start_date} → ${run.end_date} vs ${run.prev_start} → ${run.prev_end} · ${s.pagesCrawled} pages crawled · run by ${esc(run.created_by)}</div>
    <div class="card section"><div class="scores">
      <div class="score">${ring(s.scores.overall, true)}<div><b>Overall SEO score</b><div class="muted small">${s.scores.overall >= 80 ? 'Strong' : s.scores.overall >= 55 ? 'Needs work' : 'Poor'}</div></div></div>
      <div class="score">${ring(s.scores.onpage)}<div><b>On-page</b><div class="muted small">Titles, meta, headings, links, schema</div></div></div>
      <div class="score">${ring(s.scores.content)}<div><b>Content</b><div class="muted small">Query coverage & depth</div></div></div>
      <div class="score">${ring(s.scores.technical)}<div><b>Technical</b><div class="muted small">Indexability, sitemap, robots</div></div></div>
    </div></div>
    <div class="grid kpis section">
      ${kpi('Clicks', fmt(k.clicks), delta(k.clicks, k.prev?.clicks))}
      ${kpi('Impressions', fmt(k.impressions), delta(k.impressions, k.prev?.impressions))}
      ${kpi('CTR', pct(k.ctr, 2), delta(k.ctr, k.prev?.ctr, { isPct: true }))}
      ${kpi('Avg position', fmt(k.position, 1), delta(k.position, k.prev?.position, { invert: true }))}
      ${k.sessions != null ? kpi('Organic sessions', fmt(k.sessions), delta(k.sessions, k.prevSessions)) : ''}
      ${k.keyEvents != null ? kpi('Organic key events', fmt(k.keyEvents), delta(k.keyEvents, k.prevKeyEvents)) : ''}
    </div>
    <div class="tabs">${tabs.map((t, i) => `<button class="tab ${i ? '' : 'active'}" data-t="${t}">${t}</button>`).join('')}</div>
    <div id="tab"></div>`;
  const views = {
    Insights: () => viewInsights(project, run, pages),
    Opportunities: () => viewOpps(s.opps, pages, project, run),
    Pages: () => viewPages(pages, project, run),
    Queries: () => viewQueries(gsc),
    Technical: () => viewTechnical(s.site, pages),
    Traffic: () => viewTraffic(gsc, ga, run),
    History: () => viewHistory(runs, project),
  };
  const show = (t) => {
    app.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
    document.getElementById('tab').innerHTML = views[t]();
    bindTab(project, run, pages);
  };
  app.querySelectorAll('.tab').forEach((b) => (b.onclick = () => show(b.dataset.t)));
  show('Insights');
}

function bindTab(project, run, pages) {
  document.getElementById('ai-retry')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Thinking… (up to a minute)';
    try {
      await requestAi(run.id, { project, gsc: run.gsc, ga: run.ga, pages, summary: run.summary });
      route();
    } catch (err) { toast(err.message, 6000); e.target.disabled = false; e.target.textContent = 'Retry AI analysis'; }
  });
  document.getElementById('tab').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-delrun]');
    if (!b || !confirm('Delete this run permanently?')) return;
    await api('/api/runs/' + b.dataset.delrun, { method: 'DELETE' });
    location.hash = '#/p/' + project.id;
    route();
  });
  document.querySelectorAll('[data-page]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const p = pages.find((x) => x.url === a.dataset.page);
    if (p) pageDetail(p, run);
  }));
}

const impactPill = (v) => `<span class="pill ${v === 'high' ? 'bad' : v === 'medium' ? 'warn' : 'info'}">${esc(v || '')} impact</span>`;
const pageLink = (u, pages) => (pages.some((p) => p.url === u) ? `<a href="#" data-page="${esc(u)}">${esc(shortUrl(u))}</a>` : `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(shortUrl(u))}</a>`);

function viewInsights(project, run, pages) {
  const ai = run.ai;
  const btn = (label, cls) => (canRun(project) ? `<button class="btn ${cls}" id="ai-retry">${label}</button>` : '');
  if (!ai) return `<div class="card center"><h2>No AI recommendations yet</h2><p class="muted">Needs a Gemini key (free) in Settings.</p>${btn('Generate AI analysis', 'primary')}</div>`;
  const list = (arr, fn) => (arr || []).map(fn).join('') || '<p class="muted">None</p>';
  return `<div class="card"><div class="row spread"><h2 style="margin:0">Executive summary</h2><span class="pill ${ai.health === 'good' ? 'good' : ai.health === 'poor' ? 'bad' : 'warn'}">${esc((ai.health || '').replace('_', ' '))}</span></div>
      <p>${esc(ai.summary)}</p>${(ai.risks || []).length ? `<h3>Risks</h3><ul>${ai.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <div class="row spread small muted"><span>Generated ${ai.generated_at ? date(ai.generated_at) : ''} by Gemini</span>${btn('Regenerate', 'sm')}</div></div>
    <div class="card section"><h2>Priority actions</h2>${list(ai.priorities, (p) => `<div class="reco"><div class="row spread"><h3>${esc(p.title)}</h3><span class="row" style="gap:6px">${impactPill(p.impact)}<span class="pill">${esc(p.effort || '')} effort</span></span></div>
      <p><b>Why:</b> ${esc(p.why)}</p><p><b>How:</b> ${esc(p.how)}</p>${(p.urls || []).filter(Boolean).length ? `<p class="small">${p.urls.filter(Boolean).map((u) => pageLink(u, pages)).join(' · ')}</p>` : ''}</div>`)}</div>
    <div class="grid g2 section">
      <div class="card"><h2>Quick wins</h2>${list(ai.quick_wins, (q) => `<div class="check"><div><b>${esc(q.query)}</b> <span class="pill">pos ${esc(q.position)}</span><div class="small">${esc(q.action)}</div>${q.url ? `<div class="small">${pageLink(q.url, pages)}</div>` : ''}</div></div>`)}</div>
      <div class="card"><h2>Content ideas</h2>${list(ai.content_ideas, (c) => `<div class="check"><div><b>${esc(c.topic)}</b> <span class="pill info">${esc(c.type)}</span><div class="small muted">Target: ${esc(c.target_query)}</div><div class="small">${esc(c.rationale)}</div></div></div>`)}</div>
    </div>
    <div class="card section"><h2>Page-level recommendations</h2>${list(ai.page_recommendations, (p) => `<div class="reco"><h3>${pageLink(p.url, pages)}</h3><p>${esc(p.problem)}</p>
      ${p.title_suggestion ? `<p class="small"><b>Title:</b> ${esc(p.title_suggestion)}</p>` : ''}${p.meta_suggestion ? `<p class="small"><b>Meta:</b> ${esc(p.meta_suggestion)}</p>` : ''}
      ${p.h1_suggestion ? `<p class="small"><b>H1:</b> ${esc(p.h1_suggestion)}</p>` : ''}${(p.content_gaps || []).length ? `<p class="small"><b>Cover:</b> ${p.content_gaps.map(esc).join(' · ')}</p>` : ''}
      ${p.internal_links ? `<p class="small"><b>Internal links:</b> ${esc(p.internal_links)}</p>` : ''}</div>`)}</div>
    ${(ai.technical || []).length ? `<div class="card section"><h2>Technical fixes</h2>${list(ai.technical, (t) => `<div class="check"><div><b>${esc(t.issue)}</b><div class="small">${esc(t.fix)}</div></div></div>`)}</div>` : ''}`;
}

function viewOpps(o, pages) {
  const sec = (title, desc, html) => `<div class="card section"><h2>${title}</h2><p class="muted small">${desc}</p>${html}</div>`;
  const pg = (u) => (u ? pageLink(u, pages) : '–');
  return sec('🚀 Striking distance (positions 4–15)', 'High-impression queries just off the top spots — improving these pages usually gives the fastest traffic gains.',
    table([{ key: 'q', label: 'Query' }, { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) }, { key: 'c', label: 'Clicks', num: 1, render: (r) => fmt(r.c) }, { key: 'p', label: 'Pos', num: 1 }, { key: 'page', label: 'Ranking page', render: (r) => pg(r.page) }], o.quickWins))
  + sec('📉 Low CTR for position', 'Ranking well but under-clicked vs typical CTR — rewrite titles/meta to be more compelling.',
    table([{ key: 'q', label: 'Query' }, { key: 'p', label: 'Pos', num: 1 }, { key: 'ctr', label: 'CTR', num: 1, render: (r) => pct(r.ctr) }, { key: 'expected', label: 'Expected', num: 1, render: (r) => pct(r.expected, 0) }, { key: 'lostClicks', label: 'Lost clicks', num: 1 }, { key: 'page', label: 'Page', render: (r) => pg(r.page) }], o.lowCtr))
  + sec('🧩 Content gaps on key pages', 'Important queries for a page that are missing from its title, H1, headings or copy.',
    table([{ key: 'q', label: 'Query' }, { key: 'u', label: 'Page', render: (r) => pg(r.u) }, { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) }, { key: 'p', label: 'Pos', num: 1 }, { key: 'score', label: 'Coverage', num: 1, render: (r) => `<span class="pill ${pillFor(r.score)}">${r.score}</span>` }, { key: 'missing', label: 'Missing from', render: (r) => esc(r.missing.join(', ')) }], o.contentGaps))
  + sec('⚔️ Keyword cannibalisation', 'Multiple pages splitting impressions for the same query — consolidate or differentiate.',
    table([{ key: 'q', label: 'Query' }, { key: 'total', label: 'Impr.', num: 1, render: (r) => fmt(r.total) }, { key: 'pages', label: 'Competing pages', render: (r) => r.pages.map((p) => `${pg(p.u)} <span class="muted small">${fmt(p.i)} impr · pos ${p.p}</span>`).join('<br>') }], o.cannibalization))
  + `<div class="grid g2">` + sec('🔻 Declining pages', 'Pages that lost 30%+ clicks vs the previous period.',
    table([{ key: 'u', label: 'Page', render: (r) => pg(r.u) }, { key: 'c', label: 'Clicks', num: 1, render: (r) => `${fmt(r.c)} <span class="muted small">from ${fmt(r.prevC)}</span>` }, { key: 'p', label: 'Pos', num: 1, render: (r) => `${r.p} <span class="muted small">from ${r.prevP}</span>` }], o.decliningPages, { filter: false }))
  + sec('📈 Rising queries', 'Growing demand — build on what is working.',
    table([{ key: 'q', label: 'Query' }, { key: 'c', label: 'Clicks', num: 1, render: (r) => `${fmt(r.c)} <span class="muted small">from ${fmt(r.prevC)}</span>` }, { key: 'p', label: 'Pos', num: 1 }], o.risingQueries, { filter: false })) + `</div>`
  + (o.lowEngagement.length ? sec('😴 Low engagement organic landing pages (GA4)', 'Search visitors are leaving quickly — check intent match, above-the-fold content and speed.',
    table([{ key: 'path', label: 'Landing page' }, { key: 'sessions', label: 'Sessions', num: 1 }, { key: 'engagementRate', label: 'Engagement', num: 1, render: (r) => pct(r.engagementRate) }, { key: 'avgDuration', label: 'Avg time (s)', num: 1 }, { key: 'keyEvents', label: 'Key events', num: 1 }], o.lowEngagement)) : '')
  + sec('🔻 Declining queries', 'Queries that lost 30%+ clicks.',
    table([{ key: 'q', label: 'Query' }, { key: 'c', label: 'Clicks', num: 1, render: (r) => `${fmt(r.c)} <span class="muted small">from ${fmt(r.prevC)}</span>` }, { key: 'p', label: 'Pos', num: 1, render: (r) => `${r.p} <span class="muted small">from ${r.prevP}</span>` }], o.decliningQueries));
}

function viewPages(pages, project, run) {
  return `<div class="card">${table([
    { key: 'url', label: 'Page', render: (p) => `<span class="url">${esc(shortUrl(p.url))}</span>` },
    { key: 'onpage_score', label: 'On-page', num: 1, render: (p) => `<span class="pill ${pillFor(p.onpage_score)}">${p.onpage_score}</span>` },
    { key: 'content_score', label: 'Content', num: 1, render: (p) => `<span class="pill ${pillFor(p.content_score)}">${p.content_score}</span>` },
    { key: 'c', label: 'Clicks', num: 1, render: (p) => fmt(p.gsc?.c), sort: (p) => p.gsc?.c || 0 },
    { key: 'i', label: 'Impr.', num: 1, render: (p) => fmt(p.gsc?.i), sort: (p) => p.gsc?.i || 0 },
    { key: 'pos', label: 'Pos', num: 1, render: (p) => fmt(p.gsc?.p, 1), sort: (p) => p.gsc?.p || 999 },
    { key: 'sessions', label: 'Org. sessions', num: 1, render: (p) => fmt(p.ga?.sessions), sort: (p) => p.ga?.sessions || 0 },
    { key: 'issues', label: 'Issues', num: 1, render: (p) => p.checks.filter((c) => c.val < 1).length, sort: (p) => p.checks.filter((c) => c.val < 1).length },
  ], pages, { onRow: (p) => pageDetail(p, run) })}<p class="hint">Click a page for the full audit and query coverage.</p></div>`;
}

function pageDetail(p, run) {
  const m = p.meta || {};
  const rec = (run.ai?.page_recommendations || []).find((r) => r.url === p.url);
  const cats = {};
  for (const c of p.checks) (cats[c.cat] ||= []).push(c);
  openDrawer(`<h2 style="word-break:break-all"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></h2>
    <div class="row" style="gap:20px;margin:12px 0">
      <div class="score">${ring(p.onpage_score)}<b>On-page</b></div><div class="score">${ring(p.content_score)}<b>Content</b></div>
      <div class="small muted">${p.gsc ? `${fmt(p.gsc.c)} clicks · ${fmt(p.gsc.i)} impr · pos ${p.gsc.p}<br>` : ''}${p.ga ? `${fmt(p.ga.sessions)} organic sessions · ${pct(p.ga.engagementRate)} engaged · ${fmt(p.ga.keyEvents)} key events<br>` : ''}${m.wordCount != null ? `${fmt(m.wordCount)} words · HTTP ${p.status} · ${p.ms} ms` : `HTTP ${p.status}`}</div>
    </div>
    ${rec ? `<div class="reco"><h3>🤖 AI recommendation</h3><p>${esc(rec.problem)}</p>${rec.title_suggestion ? `<p class="small"><b>Title:</b> ${esc(rec.title_suggestion)}</p>` : ''}${rec.meta_suggestion ? `<p class="small"><b>Meta:</b> ${esc(rec.meta_suggestion)}</p>` : ''}${rec.h1_suggestion ? `<p class="small"><b>H1:</b> ${esc(rec.h1_suggestion)}</p>` : ''}${(rec.content_gaps || []).length ? `<p class="small"><b>Cover:</b> ${rec.content_gaps.map(esc).join(' · ')}</p>` : ''}</div>` : ''}
    ${m.title != null ? `<div class="card section"><h3>Snippet</h3><div class="small"><b>Title</b> (${(m.title || '').length}): ${esc(m.title) || '<span class="no">missing</span>'}</div>
      <div class="small"><b>Meta description</b> (${(m.description || '').length}): ${esc(m.description) || '<span class="no">missing</span>'}</div>
      <div class="small"><b>H1:</b> ${esc((m.h1s || []).join(' | ')) || '<span class="no">missing</span>'}</div>
      <div class="small"><b>Subheadings:</b> ${esc((m.subheads || []).slice(0, 12).join(' · ')) || '–'}</div></div>` : ''}
    ${(p.queries || []).length ? `<div class="card section"><h3>Query coverage — is the page targeting what it ranks for?</h3>
      <p class="muted small">✓ exact phrase · ~ most words present · ✗ missing. "Count" = exact occurrences in body copy.</p>
      ${table([
        { key: 'query', label: 'Query' }, { key: 'impressions', label: 'Impr.', num: 1, render: (q) => fmt(q.impressions) }, { key: 'position', label: 'Pos', num: 1 },
        { key: 'inTitle', label: 'Title', render: (q) => mark(q.inTitle) }, { key: 'inH1', label: 'H1', render: (q) => mark(q.inH1) }, { key: 'inH2', label: 'H2+', render: (q) => mark(q.inH2) },
        { key: 'inMeta', label: 'Meta', render: (q) => mark(q.inMeta) }, { key: 'inFirst100', label: 'Intro', render: (q) => mark(q.inFirst100) }, { key: 'inUrl', label: 'URL', render: (q) => mark(q.inUrl) },
        { key: 'bodyCount', label: 'Count', num: 1 }, { key: 'density', label: 'Density %', num: 1 }, { key: 'score', label: 'Score', num: 1, render: (q) => `<span class="pill ${pillFor(q.score)}">${q.score}</span>` },
      ], p.queries, { filter: false })}</div>` : '<div class="card section muted small">No Search Console queries recorded for this exact URL.</div>'}
    <div class="card section"><h3>On-page audit</h3>${Object.entries(cats).map(([cat, cs]) => `<div class="muted small" style="margin-top:10px;font-weight:600">${cat}</div>${cs.map((c) => `<div class="check"><span class="dot ${c.val >= 1 ? 'good' : c.val > 0 ? 'warn' : 'bad'}">${c.val >= 1 ? '✓' : c.val > 0 ? '!' : '✗'}</span><div><div>${esc(c.label)}</div>${c.detail ? `<div class="small muted" style="word-break:break-word">${esc(c.detail)}</div>` : ''}</div></div>`).join('')}`).join('')}</div>`);
}

function viewQueries(gsc) {
  const prev = Object.fromEntries(gsc.prevQueries.map((q) => [q.q, q]));
  const rows = gsc.queries.map((q) => ({ ...q, prevC: prev[q.q]?.c ?? null, prevP: prev[q.q]?.p ?? null }));
  return `<div class="card">${table([
    { key: 'q', label: 'Query' },
    { key: 'c', label: 'Clicks', num: 1, render: (r) => `${fmt(r.c)} ${delta(r.c, r.prevC)}` },
    { key: 'i', label: 'Impressions', num: 1, render: (r) => fmt(r.i) },
    { key: 'ctr', label: 'CTR', num: 1, render: (r) => pct(r.ctr) },
    { key: 'p', label: 'Position', num: 1, render: (r) => `${r.p}${r.prevP ? ` <span class="muted small">(${r.prevP})</span>` : ''}` },
  ], rows, { limit: 500 })}</div>`;
}

function viewTechnical(site, pages) {
  const dup = (title, arr) => arr.length ? `<div class="card section"><h3>${title}</h3>${arr.map(([v, urls]) => `<div class="check"><div><b>${esc(v)}</b><div class="small">${urls.map((u) => pageLink(u, pages)).join(' · ')}</div></div></div>`).join('')}</div>` : '';
  const issueCount = {};
  for (const p of pages) for (const c of p.checks) if (c.val < 1) (issueCount[c.label] ||= []).push(p.url);
  const issues = Object.entries(issueCount).sort((a, b) => b[1].length - a[1].length);
  return `<div class="grid g2"><div class="card"><h2>Site checks</h2>${site.checks.map((c) => `<div class="check"><span class="dot ${c.val >= 1 ? 'good' : c.val > 0 ? 'warn' : 'bad'}">${c.val >= 1 ? '✓' : c.val > 0 ? '!' : '✗'}</span><div><div>${esc(c.label)}</div><div class="small muted">${esc(c.detail)}</div></div></div>`).join('')}</div>
    <div class="card"><h2>Most common page issues</h2>${issues.map(([label, urls]) => `<div class="check"><span class="pill ${urls.length > pages.length / 2 ? 'bad' : 'warn'}">${urls.length}/${pages.length}</span><div>${esc(label)}</div></div>`).join('') || '<p class="muted">No issues found 🎉</p>'}</div></div>
    ${dup('Duplicate titles', site.duplicates.titles)}${dup('Duplicate meta descriptions', site.duplicates.descriptions)}`;
}

function viewTraffic(gsc, ga, run) {
  const cur = gsc.daily.filter((d) => d.d >= run.start_date), prev = gsc.daily.filter((d) => d.d <= run.prev_end);
  const devTable = table([{ key: 'k', label: 'Device' }, { key: 'c', label: 'Clicks', num: 1, render: (r) => fmt(r.c) }, { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) }, { key: 'ctr', label: 'CTR', num: 1, render: (r) => pct(r.ctr) }, { key: 'p', label: 'Pos', num: 1 }], gsc.devices, { filter: false });
  const ctyTable = table([{ key: 'k', label: 'Country', render: (r) => esc(r.k.toUpperCase()) }, { key: 'c', label: 'Clicks', num: 1, render: (r) => fmt(r.c) }, { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) }, { key: 'p', label: 'Pos', num: 1 }], gsc.countries, { filter: false });
  let gaHtml = '';
  if (ga) {
    const gcur = ga.daily.filter((d) => d.d >= run.start_date), gprev = ga.daily.filter((d) => d.d <= run.prev_end);
    gaHtml = `<div class="card section"><h2>Organic sessions (GA4)</h2>${lineChart([{ name: 'Sessions', values: gcur.map((d) => d.s), color: 'var(--good)', axis: true }, { name: 'Previous period', values: gprev.map((d) => d.s), color: 'var(--muted)', dash: true }], { labels: gcur.map((d) => d.d.slice(5)) })}</div>
    <div class="card section"><h2>Channels (GA4)</h2>${table([{ key: 'name', label: 'Channel' }, { key: 's', label: 'Sessions', num: 1, render: (r) => `${fmt(r.cur?.sessions)} ${delta(r.cur?.sessions, r.prev?.sessions)}`, sort: (r) => r.cur?.sessions || 0 }, { key: 'u', label: 'Users', num: 1, render: (r) => fmt(r.cur?.users), sort: (r) => r.cur?.users || 0 }, { key: 'e', label: 'Engagement', num: 1, render: (r) => pct(r.cur?.engagementRate), sort: (r) => r.cur?.engagementRate || 0 }, { key: 'k', label: 'Key events', num: 1, render: (r) => `${fmt(r.cur?.keyEvents)} ${delta(r.cur?.keyEvents, r.prev?.keyEvents)}`, sort: (r) => r.cur?.keyEvents || 0 }], ga.channels, { filter: false })}</div>`;
  }
  return `<div class="card"><h2>Search clicks & impressions</h2>${lineChart([
      { name: 'Clicks', values: cur.map((d) => d.c), color: 'var(--primary)', axis: true },
      { name: 'Clicks (previous period)', values: prev.map((d) => d.c), color: 'var(--muted)', dash: true },
      { name: 'Impressions (scaled)', values: cur.map((d) => d.i), color: 'var(--warn)' },
    ], { labels: cur.map((d) => d.d.slice(5)) })}</div>
    <div class="grid g2 section"><div class="card"><h2>Devices</h2>${devTable}</div><div class="card"><h2>Top countries</h2>${ctyTable}</div></div>${gaHtml}`;
}

function viewHistory(runs, project) {
  const done = runs.filter((r) => r.status === 'done').slice().reverse();
  return `<div class="card"><h2>Score & traffic over time</h2>${done.length > 1 ? lineChart([
      { name: 'Overall', values: done.map((r) => r.score), color: 'var(--primary)', axis: true },
      { name: 'On-page', values: done.map((r) => r.scores?.onpage || 0), color: 'var(--good)' },
      { name: 'Content', values: done.map((r) => r.scores?.content || 0), color: 'var(--warn)' },
    ], { labels: done.map((r) => new Date(r.created_at).toLocaleDateString()) }) : '<p class="muted">Run more analyses over time to see trends.</p>'}</div>
    <div class="card section"><h2>All runs</h2>${table([
      { key: 'created_at', label: 'Date', render: (r) => r.status === 'done' ? `<a href="#/p/${project.id}?run=${r.id}">${date(r.created_at)}</a>` : date(r.created_at) },
      { key: 'status', label: 'Status', render: (r) => `<span class="pill ${r.status === 'done' ? 'good' : r.status === 'error' ? 'bad' : 'warn'}" title="${esc(r.error || '')}">${r.status}</span>` },
      { key: 'period', label: 'Period', render: (r) => `${r.start_date} → ${r.end_date}` },
      { key: 'score', label: 'Score', num: 1 },
      { key: 'c', label: 'Clicks', num: 1, render: (r) => fmt(r.kpis?.clicks), sort: (r) => r.kpis?.clicks || 0 },
      { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.kpis?.impressions), sort: (r) => r.kpis?.impressions || 0 },
      { key: 'p', label: 'Pos', num: 1, render: (r) => fmt(r.kpis?.position, 1), sort: (r) => r.kpis?.position || 0 },
      { key: 'by', label: 'By', render: (r) => esc(r.created_by) },
      ...(isAdmin() ? [{ key: 'del', label: '', render: (r) => `<button class="btn sm danger" data-delrun="${r.id}">Delete</button>` }] : []),
    ], runs, { filter: false })}</div>`;
}

route();
