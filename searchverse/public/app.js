import { analyzePage, opportunities, siteChecks, overallScores, missingSpots, lobMatcher, brandTester, brandSplit, internalLinkPlan, robotsAccess, catOf } from './analyzer.js';

const app = document.getElementById('app');
const state = { me: null };

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 0) => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (n, d = 1) => (n == null ? '–' : fmt(n * 100, d) + '%');
const mb = (b) => (b >= 1024 * 1024 ? fmt(b / 1024 / 1024, 1) + ' MB' : fmt(b / 1024, 0) + ' KB');
function storageBar(u, extra = 0) {
  const used = u.dbBytes, lim = u.limitBytes, left = Math.max(0, lim - used);
  const pu = Math.min(100, (used / lim) * 100), pe = Math.min(100 - pu, (extra / lim) * 100);
  const col = pu + pe > 90 ? 'var(--bad)' : pu + pe > 70 ? 'var(--warn)' : 'var(--primary)';
  return `<div class="progress" style="height:12px;display:flex"><div style="width:${pu}%;background:${col}"></div><div style="width:${pe}%;background:${col};opacity:.35"></div></div>
    <div class="row spread small"><span><b>${mb(used)}</b> used of ${mb(lim)} (free plan${u.databases?.length > 1 ? `, ${u.databases.length} databases` : ''})${u.exact ? '' : ' · approx.'}</span><span><b>${mb(left)}</b> left</span></div>`;
}
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
    if ((m = path.match(/^\/p\/(\w+)\/lob$/))) return await renderLob(m[1], p);
    if ((m = path.match(/^\/p\/(\w+)\/urls$/))) return await renderUrls(m[1], p);
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
  app.innerHTML = `${err}${p.mailconnected ? `<div class="banner">✅ Invites will now be sent automatically from <b>${esc(p.mailconnected)}</b>.</div>` : ''}${p.connected ? `<div class="banner">✅ Connected <b>${esc(p.connected)}</b>. You can now use its Search Console / GA4 properties in projects.</div>` : ''}
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
  if (isAdmin()) {
    const ms = me.mailSender;
    const msAge = ms ? Math.floor((Date.now() - ms.connected_at) / 86400000) : 0;
    app.insertAdjacentHTML('beforeend', `<div class="card section"><h2>✉️ Invite emails</h2>
      <div class="check"><div style="flex:1"><b>Send from my own mailbox (recommended)</b>
        <div class="small muted">When you click <b>✉️ Invite</b> or add someone, the invite is sent automatically from your Gmail / Google Workspace address and appears in your Sent folder. Uses Google's “send email on your behalf” permission only — Searchverse can't read your mail.</div>
        <div style="margin-top:6px">${ms && !ms.expired ? `<span class="pill good">Connected: ${esc(ms.google_email)}</span> <span class="small muted">${7 - msAge > 0 ? `reconnect in ${7 - msAge} day(s) (Google testing mode)` : 'may need reconnecting'}</span>` : ms ? `<span class="pill bad">Expired: ${esc(ms.google_email)}</span>` : '<span class="pill warn">Not connected</span>'}</div></div>
        <a class="btn ${ms && !ms.expired ? '' : 'primary'}" href="/auth/connect-mail">${ms ? 'Reconnect' : 'Connect my mailbox'}</a></div>
      <div class="check"><div style="flex:1"><b>Backup: Brevo</b> <span class="small muted">— used if your mailbox isn't connected</span><div style="margin-top:6px">${me.mailEnabled ? '<span class="pill good">On</span>' : '<span class="pill">Not set up</span> <span class="small muted">(optional — see GO-LIVE-GUIDE)</span>'}</div></div></div>
      <p class="hint">If neither is set up, your own mail app opens with the invite ready to send.</p></div>`);
    app.insertAdjacentHTML('beforeend', `<div class="card section" id="storage-card"><h2>💾 Storage</h2><p class="muted small">Loading…</p></div>`);
    Promise.all([api('/api/usage'), api('/api/retention')]).then(([u, r]) => {
      u.retentionDays = r.days;
      document.getElementById('storage-card').innerHTML = `<h2>💾 Storage</h2>${storageBar(u)}
        <div class="row small" style="margin:8px 0">${(u.databases || []).map((d) => `<span class="pill ${d.bytes / d.limit > 0.9 ? 'bad' : d.bytes / d.limit > 0.7 ? 'warn' : 'info'}">${d.name === 'main' ? 'Main' : d.name}: ${mb(d.bytes)} / 500 MB</span>`).join(' ')}</div>
        ${(u.databases || []).length < 10 ? `<p class="small">➕ <b>Need more space? It's free:</b> in Terminal (searchverse folder) run <code>npm run add-storage</code> then <code>npm run deploy</code>. Each run adds 500 MB — up to ${mb(10 * 500 * 1024 * 1024)} on the free plan (you have ${(u.databases || []).length} of 10 databases).</p>` : '<p class="small">You are using the free maximum of 10 databases (5 GB).</p>'}
        <p class="small muted">Average crawled page ≈ ${mb(u.avgPageBytes)} · full export ≈ ${u.exportBytesPerRow} bytes per row (compressed). Free D1 databases hold ${mb(u.limitBytes)}. To free space, open a project → History → Delete old runs.</p>
        <div class="card" style="margin:14px 0;padding:14px"><b>🗄️ Data retention</b>
          <p class="small muted" style="margin:4px 0 10px">Recent runs keep everything. Older runs keep scores, KPIs, the AI report and the History trend, but their crawled pages, exports and raw data are removed. Runs automatically after every analysis.</p>
          <div class="row"><select id="ret-days" style="width:auto">${[[0, 'Keep everything (no cleanup)'], [30, 'Keep full detail for 30 days'], [60, 'Keep full detail for 60 days'], [90, 'Keep full detail for 90 days'], [180, 'Keep full detail for 180 days'], [365, 'Keep full detail for 1 year']].map(([d, l]) => `<option value="${d}" ${u.retentionDays === d ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="btn primary" id="ret-save">Save</button><button class="btn" id="ret-clean">Clean up now</button></div></div>
        ${table([{ key: 'name', label: 'Project', render: (p) => `<a href="#/p/${p.id}">${esc(p.name)}</a>` }, { key: 'runs', label: 'Runs', num: 1 }, { key: 'pagesCount', label: 'Pages stored', num: 1, render: (p) => fmt(p.pagesCount) }, { key: 'pages', label: 'Page data', num: 1, render: (p) => mb(p.pages) }, { key: 'exports', label: 'Exports', num: 1, render: (p) => mb(p.exports) }, { key: 'bytes', label: 'Total', num: 1, render: (p) => `<b>${mb(p.bytes)}</b>` }], u.projects, { filter: false })}`;
      const after = (r) => { toast(r.archived ? `Archived ${r.archived} older run(s)` : 'Nothing to clean up'); route(); };
      document.getElementById('ret-save').onclick = async () => after(await api('/api/retention', { method: 'PUT', body: { days: +document.getElementById('ret-days').value } }));
      document.getElementById('ret-clean').onclick = async () => after(await api('/api/retention/cleanup', { method: 'POST' }));
    }).catch(() => {});
  }
  app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this Google account? Projects using it will stop updating until you pick another account.')) return;
    await api('/api/connections/' + b.dataset.del, { method: 'DELETE' });
    route();
  });
  const saveKey = async (geminiKey) => { await api('/api/settings', { method: 'PUT', body: { geminiKey } }); state.me = null; toast('Saved'); location.hash = '#/settings'; route(); };
  document.getElementById('savekey').onclick = () => { const v = document.getElementById('gkey').value.trim(); if (v) saveKey(v); };
  document.getElementById('clearkey')?.addEventListener('click', () => saveKey(''));
}

// ---------- invites ----------
// Emails the invite through Brevo when configured; otherwise opens your own mail app with the message ready.
function openMailApp(r) {
  location.href = `mailto:${encodeURIComponent(r.to)}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.text)}`;
}
async function sendInviteUi(email, projectId, role, alreadySent) {
  if (alreadySent?.emailed) return toast(`✉️ Invite emailed to ${email}${alreadySent.via === 'gmail' ? ` from ${alreadySent.from}` : ''}`);
  try {
    const r = await api('/api/invite', { method: 'POST', body: { email, projectId, role, manualOnly: alreadySent && alreadySent.reason === 'not_configured' } });
    if (r.emailed) return toast(`✉️ Invite emailed to ${email}${r.via === 'gmail' ? ` from ${r.from}` : ''}`);
    openMailApp(r);
    toast(r.reason === 'not_configured' || r.reason === 'manual' ? 'Opening your mail app with the invite ready — just press Send' : `Auto-email failed (${r.reason}) — opening your mail app instead`, 6000);
  } catch (e) { toast(e.message); }
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
    <div class="row" style="margin-top:20px"><button class="btn primary" id="ue-save">${isNew ? 'Add user & send invite' : 'Save'}</button>${isNew ? '' : '<button class="btn" id="ue-inv">✉️ Send invite</button><button class="btn danger" id="ue-del">Remove user</button>'}</div>`);
  document.getElementById('ue-inv')?.addEventListener('click', () => sendInviteUi(u.email, u.projects[0]?.id, u.role === 'admin' ? 'admin' : u.projects[0]?.role || 'editor'));
  const role = document.getElementById('ue-role');
  role.onchange = () => document.getElementById('ue-proj').classList.toggle('hidden', role.value === 'admin');
  document.getElementById('ue-save').onclick = async () => {
    const projectsSel = [...document.querySelectorAll('[data-pid]')].filter((s) => s.value).map((s) => ({ id: s.dataset.pid, role: s.value }));
    const b = { role: role.value, projects: role.value === 'admin' ? [] : projectsSel };
    try {
      if (isNew) {
        const email = document.getElementById('ue-email').value.trim().toLowerCase();
        const r = await api('/api/users', { method: 'POST', body: { ...b, email } });
        await sendInviteUi(email, b.projects[0]?.id, b.role === 'admin' ? 'admin' : b.projects[0]?.role || 'editor', r);
      }
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
        <label>Pages to crawl per run <span class="muted">(default for new runs)</span></label><input id="f-max" type="number" min="5" max="1000" value="${p.max_pages || 25}">
        <div class="hint"><b>What it means:</b> how many pages of your site the tool opens and checks on each run (titles, meta, H1, schema, content vs. keywords, speed, AI-search readiness…).
          Money pages go first, then the pages with the most Search Console clicks & impressions. Pages beyond this number still count in GSC/GA numbers — they just aren't audited.<br>
          <b>Suggestion:</b> 100 for a quick weekly check · 250–500 for a monthly deep audit · up to 1,000 for the whole site or all LOB pages. ≈ 1 minute per 100 pages; you can change it on each run.</div>
        <label>💰 Money pages <span class="muted">(always crawled first, highlighted, prioritised by the AI)</span></label>
        <textarea id="f-money" rows="5" placeholder="https://www.example.com/plans/broadband&#10;https://www.example.com/postpaid">${esc(p.money_pages || '')}</textarea>
        <div class="hint">One full URL per line (up to 300).</div>
        <label>🏷️ Brand terms <span class="muted">(queries containing these are "branded")</span></label>
        <input id="f-brand" value="${esc(p.brand_terms || '')}" placeholder="airtel, xstream, airtel thanks">
        <div class="hint">Comma separated. Spaces are ignored when matching, so "airtel" also matches "air tel".</div>
        <label>🎯 Lead event in GA4 <span class="muted">(optional)</span></label>
        <input id="f-lead" value="${esc(p.lead_event || '')}" placeholder="e.g. generate_lead or form_submit">
        <div class="hint">The exact GA4 key event name that counts as a lead. Shown as a separate "Leads" column.</div>
        <div class="hint">Top pages by clicks & impressions from Search Console (5–100).</div>
        <div class="row" style="margin-top:20px"><button class="btn primary" id="f-save" ${isOwner ? '' : 'disabled'}>${pid ? 'Save changes' : 'Create project'}</button>
        ${pid && isOwner ? '<button class="btn danger" id="f-del">Delete project</button>' : ''}</div>
      </div>
      ${pid ? `<div class="card"><h2>Team access</h2>
        <p class="muted small">Admins see every project. Members only see the projects you add them to: <b>View only</b> lets them see results, and <b>Can run analysis</b> also lets them run new analyses. Members sign in with their own Google account.</p>
        ${(p.members || []).map((m) => `<div class="check"><div style="flex:1">${esc(m.email)}<div>${accessPill(m.role)}</div></div><button class="btn sm" data-inv="${esc(m.email)}" data-role="${m.role}">✉️ Invite</button><button class="btn sm danger" data-rm="${esc(m.email)}">Remove</button></div>`).join('') || '<p class="muted">No members yet. Only admins can see this project.</p>'}
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
      site_url: document.getElementById('f-site').value, max_pages: document.getElementById('f-max').value, money_pages: document.getElementById('f-money').value, brand_terms: document.getElementById('f-brand').value, lead_event: document.getElementById('f-lead').value,
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
    const email = document.getElementById('m-email').value.trim(), role = document.getElementById('m-role').value;
    try { const r = await api(`/api/projects/${pid}/members`, { method: 'POST', body: { email, role } }); await sendInviteUi(email.toLowerCase(), pid, role, r); route(); } catch (e) { toast(e.message); }
  });
  app.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = () => sendInviteUi(b.dataset.inv, pid, b.dataset.role)));
  app.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => { await api(`/api/projects/${pid}/members`, { method: 'DELETE', body: { email: b.dataset.rm } }); route(); });
}

// ---------- runner ----------
const isoDay = (d) => d.toISOString().slice(0, 10);
function presetRange(key) {
  const today = new Date();
  const lastData = new Date(Date.now() - 3 * 86400000); // GSC lags ~2-3 days
  const back = (n) => new Date(lastData.getTime() - (n - 1) * 86400000);
  const mStart = (y, m) => new Date(Date.UTC(y, m, 1));
  const mEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0));
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  switch (key) {
    case '7': return [back(7), lastData];
    case '90': return [back(90), lastData];
    case 'lm': return [mStart(y, m - 1), mEnd(y, m - 1)];
    case 'l3m': return [mStart(y, m - 3), mEnd(y, m - 1)];
    case 'l6m': return [mStart(y, m - 6), mEnd(y, m - 1)];
    case 'l12m': return [mStart(y, m - 12), mEnd(y, m - 1)];
    default: return [back(28), lastData];
  }
}

async function renderRunner(pid) {
  const { project } = await api('/api/projects/' + pid);
  if (!canRun(project)) { app.innerHTML = '<div class="banner err">You have view-only access to this project.</div>'; return; }
  const money = (project.money_pages || '').split('\n').filter(Boolean);
  const { groups: lobGroups } = await api(`/api/projects/${pid}/lobs`);
  const lobCats = [...new Set(lobGroups.map((g) => g.category).filter(Boolean))];
  const [s0, e0] = presetRange('28');
  app.innerHTML = `<div class="row spread"><div><h1>Run analysis</h1><div class="muted">${esc(project.name)} · ${esc(project.gsc_property)}</div></div><a class="btn" href="#/p/${pid}">Back</a></div>
    <div class="card section" id="setup">
      <h3>📅 Date range</h3>
      <div class="row" style="align-items:flex-end">
        <div><label class="small" style="margin-top:0">Preset</label><select id="r-preset" style="width:auto">
          <option value="28">Last 28 days</option><option value="7">Last 7 days</option><option value="90">Last 90 days</option>
          <option value="lm">Last month</option><option value="l3m">Last 3 months</option><option value="l6m">Last 6 months</option><option value="l12m">Last 12 months</option>
          <option value="custom">Custom…</option></select></div>
        <div><label class="small" style="margin-top:0">From</label><input type="date" id="r-start" value="${isoDay(s0)}" style="width:auto"></div>
        <div><label class="small" style="margin-top:0">To</label><input type="date" id="r-end" value="${isoDay(e0)}" style="width:auto"></div>
        <div><label class="small" style="margin-top:0">Compare with</label><select id="r-compare" style="width:auto"><option value="previous">Previous period</option><option value="year">Same period last year</option><option value="custom">Custom dates…</option></select></div>
        <div class="r-cust hidden"><label class="small" style="margin-top:0">Compare from</label><input type="date" id="r-pstart" style="width:auto"></div>
        <div class="r-cust hidden"><label class="small" style="margin-top:0">Compare to</label><input type="date" id="r-pend" style="width:auto"></div>
      </div>
      <div class="hint" id="r-cmp-text"></div>

      <h3 style="margin-top:22px">🎯 Scope</h3>
      <select id="r-scope" style="width:auto"><option value="">Whole site</option>
        ${lobGroups.length ? `<option value="all">Only my LOB pages (all ${lobGroups.length} groups)</option>` : ''}
        ${lobCats.map((c) => `<option value="cat:${esc(c)}">Only LOB: ${esc(c)}</option>`).join('')}</select>
      <div class="hint">${lobGroups.length ? 'LOB scope analyses, crawls and scores only URLs matching your LOB page paths (money pages are always included). Use the full export below so every LOB URL is covered.' : `Set up LOB groups in the <a href="#/p/${pid}/lob">LOB report</a> to analyse only those page paths.`}</div>

      <h3 style="margin-top:22px">🕷️ Crawl</h3>
      <div class="row" style="align-items:flex-end">
        <div><label class="small" style="margin-top:0">Pages to crawl</label><select id="r-maxsel" style="width:auto">
          ${[[25, 'Top 25 — quick check (~30 sec)'], [50, 'Top 50 (~1 min)'], [100, 'Top 100 — weekly check (~1–2 min)'], [250, 'Top 250 — monthly audit (~3 min)'], [500, 'Top 500 — deep audit (~5–6 min)'], [750, 'Top 750 (~8 min)'], [1000, 'Max 1,000 — full / all LOB pages (~10–12 min)'], ['custom', 'Custom number…']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div id="r-max-wrap" class="hidden"><label class="small" style="margin-top:0">Custom</label><input id="r-max" type="number" min="5" max="1000" value="${project.max_pages}" style="width:110px"></div>
        <label class="row small" style="margin:0 0 10px;gap:6px;font-weight:400"><input type="checkbox" id="r-sitemap" style="width:auto"> Also crawl URLs from the sitemap</label>
      </div>
      <div class="banner small" id="r-rec" style="margin:10px 0 6px"></div>
      <div class="hint"><b>Pages to crawl</b> = how many pages get opened and audited (on-page, content vs. keywords, technical, AI-search). It doesn't limit the Search Console / GA numbers — those always cover the whole site or the chosen LOBs.<br>💰 ${money.length ? `<b>${money.length} money page${money.length > 1 ? 's' : ''}</b> always crawled first` : 'No money pages set'}${isAdmin() ? ` · <a href="#/p/${pid}/edit">edit money pages</a>` : ''}. Then the top Search Console pages by clicks & impressions${' '}fill up the rest. Maximum 1,000 pages per run (≈ 1 min per 100 pages).</div>

      <h3 style="margin-top:22px">📦 Search Console data</h3>
      <div class="row"><select id="r-rows" style="width:auto">
        <option value="0">Standard — top 1,000 queries & pages (fast)</option>
        <option value="25000">Full export — up to 25,000 rows</option>
        <option value="50000">Full export — up to 50,000 rows</option>
        <option value="100000">Full export — up to 100,000 rows</option>
        <option value="250000">Full export — up to 250,000 rows</option>
        <option value="500000">Full export — up to 500,000 rows (slow)</option>
        <option value="1000000">Full export — up to 1,000,000 rows (very slow)</option>
        <option value="5000000">Everything Search Console returns — no cap (slowest)</option></select>
        <span class="small muted" id="r-rows-note"></span></div>
      <div class="hint">Full export pulls every query, every page and every page × query pair (25,000 rows per request), uses them for the scores and opportunities, and saves them with the run for the Queries tab & CSV.</div>

      <h3 style="margin-top:22px">💾 Storage</h3>
      <div id="r-storage" class="muted small">Checking storage…</div>

      <div class="row" style="margin-top:22px"><button class="btn primary lg" id="r-go">▶ Start analysis</button>
        <span class="small muted">Keep this tab open while it runs.</span></div>
    </div>
    <div class="card section hidden" id="prog"><h2 id="p-step">Starting…</h2><div class="progress"><div id="p-bar" style="width:2%"></div></div><div class="log" id="p-log"></div></div>`;
  const $ = (id) => document.getElementById(id);
  const cmpText = () => {
    const s = new Date($('r-start').value), e = new Date($('r-end').value);
    if (isNaN(s) || isNaN(e) || s > e) { $('r-cmp-text').textContent = 'Pick a valid range'; return; }
    const len = Math.round((e - s) / 86400000) + 1;
    let ps, pe;
    document.querySelectorAll('.r-cust').forEach((el) => el.classList.toggle('hidden', $('r-compare').value !== 'custom'));
    if ($('r-compare').value === 'custom') {
      if (!$('r-pstart').value) { const pe0 = new Date(s.getTime() - 86400000); $('r-pend').value = isoDay(pe0); $('r-pstart').value = isoDay(new Date(pe0.getTime() - (len - 1) * 86400000)); }
      ps = new Date($('r-pstart').value); pe = new Date($('r-pend').value);
    } else if ($('r-compare').value === 'year') { ps = new Date(s); ps.setUTCFullYear(ps.getUTCFullYear() - 1); pe = new Date(e); pe.setUTCFullYear(pe.getUTCFullYear() - 1); }
    else { pe = new Date(s.getTime() - 86400000); ps = new Date(pe.getTime() - (len - 1) * 86400000); }
    $('r-cmp-text').textContent = `${len} days: ${isoDay(s)} → ${isoDay(e)}, compared with ${isoDay(ps)} → ${isoDay(pe)}. Search Console keeps ~16 months and lags 2–3 days.`;
  };
  $('r-preset').onchange = () => {
    if ($('r-preset').value !== 'custom') { const [s, e] = presetRange($('r-preset').value); $('r-start').value = isoDay(s); $('r-end').value = isoDay(e); }
    cmpText();
  };
  ['r-start', 'r-end'].forEach((id) => ($(id).onchange = () => { $('r-preset').value = 'custom'; cmpText(); }));
  $('r-compare').onchange = cmpText;
  const rowsNote = () => {
    const n = +$('r-rows').value;
    $('r-rows-note').textContent = !n ? '' : n <= 100000 ? '≈ 1–3 min' : n <= 500000 ? '≈ 5–10 min, keep the tab open' : 'can take 15+ min on big sites; Search Console decides how many rows it gives (it stops when there are no more)';
  };
  $('r-rows').onchange = () => { rowsNote(); storageNote(); };
  $('r-max').oninput = () => storageNote();
  // dropdown ↔ number box, and a recommendation that follows scope + Search Console data choice
  const setPages = (n) => { $('r-max').value = n; storageNote(); };
  $('r-maxsel').onchange = () => {
    const v = $('r-maxsel').value;
    $('r-max-wrap').classList.toggle('hidden', v !== 'custom');
    if (v !== 'custom') setPages(+v);
  };
  const presetFor = (n) => ([25, 50, 100, 250, 500, 750, 1000].includes(+n) ? String(n) : 'custom');
  $('r-maxsel').value = presetFor(project.max_pages);
  $('r-max-wrap').classList.toggle('hidden', $('r-maxsel').value !== 'custom');
  const recommend = () => {
    const scope = $('r-scope').value, rows = +$('r-rows').value;
    let n, why;
    if (scope) {
      n = rows ? 1000 : 500;
      why = `LOB scope only crawls pages matching your LOB paths, so a high limit simply means "all LOB pages" — it stops when there are no more.${rows ? '' : ' Pick a Full export below so every LOB URL is found.'}`;
    } else if (rows >= 100000) { n = 500; why = 'With a full export you know every ranking page; 500 covers the pages that carry almost all traffic on a big site.'; }
    else if (rows) { n = 250; why = 'Full export + 250 pages gives a solid monthly audit.'; }
    else { n = 100; why = 'Standard data covers the top 1,000 pages; auditing the top 100 is a good weekly check.'; }
    n = Math.max(n, Math.min(1000, money.length));
    const opts = [...$('r-maxsel').options];
    opts.forEach((o) => (o.textContent = o.textContent.replace(' ⭐ recommended', '')));
    const o = opts.find((x) => +x.value === n); if (o) o.textContent += ' ⭐ recommended';
    $('r-rec').innerHTML = `💡 <b>Suggested: ${fmt(n)} pages</b> for ${scope ? (scope === 'all' ? 'all LOB pages' : 'LOB ' + esc(scope.slice(4))) : 'the whole site'} with ${rows ? 'a full export' : 'standard data'}. ${why} <a href="#" id="r-userec">Use ${fmt(n)}</a>`;
    $('r-userec').onclick = (e) => { e.preventDefault(); $('r-maxsel').value = String(n); $('r-max-wrap').classList.add('hidden'); setPages(n); };
  };
  $('r-scope').addEventListener('change', recommend);
  $('r-rows').addEventListener('change', recommend);
  recommend();
  let usage = null;
  const storageNote = () => {
    if (!usage) return;
    const pages = Math.min(1000, Math.max(5, +$('r-max').value || 25));
    const rows = +$('r-rows').value;
    const rowsEst = rows >= 1000000 ? 1000000 : rows * 1.1; // page×query dominates; "everything" estimated at 1M
    const est = usage.avgRunBytes + pages * usage.avgPageBytes + rowsEst * 2 * usage.exportBytesPerRow;
    const left = Math.max(0, usage.limitBytes - usage.dbBytes);
    const runsLeft = Math.floor(left / est);
    const maxPages = Math.max(0, Math.min(1000, Math.floor((left - usage.avgRunBytes - rowsEst * 2 * usage.exportBytesPerRow) / usage.avgPageBytes)));
    $('r-storage').innerHTML = storageBar(usage, est) + `
      <div class="small" style="margin-top:6px">This run: <b>≈ ${mb(est)}</b> (${fmt(pages)} pages × ~${mb(usage.avgPageBytes)}${rows ? ` + ~${mb(rowsEst * 2 * usage.exportBytesPerRow)} export` : ''}).
      ${est > left ? '<b class="down">Not enough space — delete old runs (History tab) or pick fewer pages / a smaller export.</b>' : `You can do <b>~${fmt(runsLeft)}</b> more runs like this${usage.retention ? ` (older runs are slimmed after ${usage.retention} days, so space is reused)` : ' — turn on Data retention in Settings to reuse space automatically'}. With the space left you can crawl up to <b>${fmt(maxPages)}</b> pages per run (limit 1,000).`}</div>`;
  };
  Promise.all([api('/api/usage'), api('/api/retention')]).then(([u, r]) => { usage = { ...u, retention: r.days }; storageNote(); }).catch(() => ($('r-storage').textContent = 'Storage info unavailable'));
  ['r-pstart', 'r-pend'].forEach((id) => ($(id).onchange = cmpText));
  cmpText();
  $('r-go').onclick = () => runAnalysis(project, {
    start: $('r-start').value, end: $('r-end').value, compare: $('r-compare').value, pstart: $('r-pstart').value, pend: $('r-pend').value, allGroups: lobGroups,
    maxPages: Math.min(1000, Math.max(5, +$('r-max').value || 25)), sitemap: $('r-sitemap').checked, rows: +$('r-rows').value, money,
    scope: $('r-scope').value,
    scopeGroups: $('r-scope').value === 'all' ? lobGroups : $('r-scope').value.startsWith('cat:') ? lobGroups.filter((g) => g.category === $('r-scope').value.slice(4)) : [],
  });
}

// Pages through Search Console results 25k rows at a time (via the Worker) and returns compact rows.
async function gscAll(runId, start, end, dimensions, cap, onProgress) {
  const rows = [];
  for (let startRow = 0; startRow < cap; startRow += 25000) {
    const res = await fetch(`/api/runs/${runId}/gsc-rows`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit: Math.min(25000, cap - startRow), startRow }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || data.error || 'Search Console export failed');
    const batch = data.rows || [];
    for (const r of batch) rows.push([...r.keys, r.clicks, r.impressions, +r.ctr.toFixed(4), +r.position.toFixed(1)]);
    onProgress?.(rows.length);
    if (batch.length < 25000) break;
  }
  return rows;
}

// Exports are gzip-compressed in the browser and saved in chunks well under the database's 2 MB row limit
// (byte-sized, so non-English queries — 3 bytes per character — can't overflow a chunk).
const enc = new TextEncoder();
async function gzipB64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunzipB64(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
async function saveBlob(runId, kind, rows) {
  let chunk = 0, buf = [], size = 0;
  const flush = async () => {
    if (!buf.length) return;
    const body = 'gz:' + (await gzipB64(JSON.stringify(buf)));
    const res = await fetch(`/api/runs/${runId}/blob?kind=${kind}&chunk=${chunk++}`, { method: 'POST', body });
    if (!res.ok) throw new Error(`Saving ${kind} export failed (${(await res.json().catch(() => ({}))).error || res.status})`);
    buf = []; size = 0;
  };
  for (const r of rows) { const s = enc.encode(JSON.stringify(r)).length + 1; if (size + s > 3_000_000) await flush(); buf.push(r); size += s; }
  await flush();
}
async function loadBlob(runId, kind) {
  const res = await fetch(`/api/runs/${runId}/blob?kind=${kind}`);
  if (!res.ok) throw new Error('Export not stored for this run');
  const d = await res.json();
  if (!d.gz) return d;
  const parts = await Promise.all(d.gz.map(async (b) => JSON.parse(await gunzipB64(b))));
  return parts.flat();
}

async function sitemapUrls(fetchUrl, firstUrl, limit) {
  const out = new Set();
  const queue = [firstUrl];
  let fetched = 0;
  while (queue.length && out.size < limit && fetched < 12) {
    const f = await fetchUrl(queue.shift());
    fetched++;
    const xml = f.html || '';
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((x) => x[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(xml)) queue.push(...locs);
    else for (const l of locs) { if (out.size >= limit) break; out.add(l); }
  }
  return [...out];
}

async function runAnalysis(project, opt) {
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('prog').classList.remove('hidden');
  const logEl = document.getElementById('p-log');
  const log = (m, cls = '') => { logEl.insertAdjacentHTML('beforeend', `<div class="${cls}">${esc(m)}</div>`); logEl.scrollTop = 1e9; };
  const step = (m, p) => { document.getElementById('p-step').textContent = m; document.getElementById('p-bar').style.width = p + '%'; log('› ' + m); };
  const maxPages = opt.maxPages;
  let run;
  try {
    step('Creating run', 2);
    run = (await api(`/api/projects/${project.id}/runs`, { method: 'POST', body: { start: opt.start, end: opt.end, compare: opt.compare, pstart: opt.pstart, pend: opt.pend } })).run;
    log(`Period ${run.start} → ${run.end} (compared with ${run.pstart} → ${run.pend})`);

    step('Fetching Search Console data', 5);
    const { gsc } = await api(`/api/runs/${run.id}/gsc`, { method: 'POST' });
    log(`${fmt(gsc.totals.clicks)} clicks, ${fmt(gsc.totals.impressions)} impressions`);

    let full = null;
    if (opt.rows) {
      full = {};
      for (const [kind, dims] of [['queries', ['query']], ['pages', ['page']], ['pagequeries', ['page', 'query']]]) {
        step(`Full export: ${kind === 'pagequeries' ? 'page × query pairs' : 'all ' + kind}`, 8);
        full[kind] = await gscAll(run.id, run.start, run.end, dims, opt.rows, (n) => (document.getElementById('p-step').textContent = `Full export: ${kind} — ${fmt(n)} rows`));
        log(`${fmt(full[kind].length)} ${kind} rows`);
      }
      step('Saving full export', 12);
      for (const k of Object.keys(full)) {
        try { await saveBlob(run.id, k, full[k]); }
        catch (e) { log(`${e.message} — analysis continues, but this export won't be downloadable later`, 'no'); full.unsaved = true; }
      }
      // use the complete lists for the analysis
      gsc.queries = full.queries.map(([q, c, i, ctr, p]) => ({ q, c, i, ctr, p }));
      gsc.pages = full.pages.map(([u, c, i, ctr, p]) => ({ u, c, i, ctr, p }));
      gsc.pageQueries = full.pagequeries.map(([u, q, c, i, ctr, p]) => ({ u, q, c, i, ctr, p }));
    }

    let ga = null;
    if (project.ga4_property) {
      step('Fetching GA4 data', 14);
      try { ga = (await api(`/api/runs/${run.id}/ga`, { method: 'POST' })).ga; log(`${ga.landing.length} organic landing pages`); }
      catch (e) { log('GA4 skipped: ' + e.message, 'no'); }
    }

    // LOB scope: keep only URLs matching the chosen LOB groups
    const inScope = opt.scopeGroups.length ? lobMatcher(opt.scopeGroups) : null;
    if (inScope) {
      const keep = (u) => !!inScope(u);
      gsc.pages = gsc.pages.filter((p) => keep(p.u));
      gsc.prevPages = gsc.prevPages.filter((p) => keep(p.u));
      gsc.pageQueries = gsc.pageQueries.filter((r) => keep(r.u));
      const qa = {};
      for (const r of gsc.pageQueries) { const t = (qa[r.q] ||= { q: r.q, c: 0, i: 0, pw: 0 }); t.c += r.c; t.i += r.i; t.pw += r.p * r.i; }
      gsc.queries = Object.values(qa).map((t) => ({ q: t.q, c: t.c, i: t.i, ctr: t.i ? +(t.c / t.i).toFixed(4) : 0, p: t.i ? +(t.pw / t.i).toFixed(1) : 0 })).sort((a, b) => b.c - a.c);
      gsc.prevQueries = [];
      const tot = (list) => { const c = list.reduce((s, r) => s + r.c, 0), i = list.reduce((s, r) => s + r.i, 0); return { clicks: c, impressions: i, ctr: i ? c / i : 0, position: i ? list.reduce((s, r) => s + r.p * r.i, 0) / i : 0 }; };
      gsc.totals = tot(gsc.pages);
      gsc.prevTotals = tot(gsc.prevPages);
      const origin0 = new URL(project.site_url).origin;
      if (ga) ga.landing = ga.landing.filter((l) => keep(origin0 + l.path));
      log(`LOB scope: ${fmt(gsc.pages.length)} pages, ${fmt(gsc.queries.length)} queries, ${fmt(gsc.totals.clicks)} clicks${opt.rows ? '' : ' (top 1,000 pages only — use the full export for complete LOB numbers)'}`);
    }
    const isBranded = brandTester(project.brand_terms);
    const brand = brandSplit(gsc.queries, isBranded);

    // comparison-period queries/pages for winners & losers
    let prevQ = gsc.prevQueries, prevP = gsc.prevPages;
    try {
      if (inScope) {
        step('Fetching comparison-period data for LOB pages', 15);
        const ppq = (await gscAll(run.id, run.pstart, run.pend, ['page', 'query'], opt.rows || 25000)).filter((r) => inScope(r[0]));
        prevQ = aggQueries(ppq.map(([u, q, c, i, ctr, p]) => ({ u, q, c, i, p })));
      } else if (opt.rows) {
        step('Full export: comparison period', 15);
        prevQ = (await gscAll(run.id, run.pstart, run.pend, ['query'], opt.rows)).map(([q, c, i, ctr, p]) => ({ q, c, i, ctr, p }));
        prevP = (await gscAll(run.id, run.pstart, run.pend, ['page'], opt.rows)).map(([u, c, i, ctr, p]) => ({ u, c, i, ctr, p }));
      }
    } catch (e) { log('Comparison export skipped: ' + e.message, 'no'); }
    const prevBrand = brandSplit(prevQ, isBranded);

    const fetchUrl = (u) => api(`/api/projects/${project.id}/fetch?url=${encodeURIComponent(u)}`).catch((e) => ({ url: u, finalUrl: u, status: 0, error: e.message, redirects: [], html: '' }));
    step('Checking robots.txt & sitemap', 16);
    const origin = new URL(project.site_url).origin;
    const robots = await fetchUrl(origin + '/robots.txt');
    const smUrl = (robots.html || '').match(/^\s*sitemap:\s*(\S+)/im)?.[1] || origin + '/sitemap.xml';
    const sitemap = await fetchUrl(smUrl);
    const llms = await fetchUrl(origin + '/llms.txt');

    // pick pages: money pages → homepage → top by clicks → top by impressions → sitemap
    const moneySet = new Set(opt.money);
    const urls = [];
    const add = (u) => { if (u && !urls.includes(u) && urls.length < Math.max(maxPages, opt.money.length) && (!inScope || moneySet.has(u) || inScope(u))) urls.push(u); };
    opt.money.forEach(add);
    add(project.site_url);
    [...gsc.pages].sort((a, b) => b.c - a.c).slice(0, Math.ceil(maxPages * 0.6)).forEach((p) => add(p.u));
    [...gsc.pages].sort((a, b) => b.i - a.i).forEach((p) => add(p.u));
    if (opt.sitemap && urls.length < maxPages) {
      step('Reading sitemap', 18);
      const sm = await sitemapUrls(fetchUrl, smUrl, maxPages * 3);
      sm.forEach(add);
      log(`${fmt(sm.length)} URLs found in sitemap`);
    }
    log(`Crawling ${urls.length} pages (${opt.money.length} money pages first)`);

    const pqByPage = {};
    for (const r of gsc.pageQueries) (pqByPage[r.u] ||= []).push(r);
    const gscPage = Object.fromEntries(gsc.pages.map((p) => [p.u, p]));
    const gaByPath = {};
    for (const l of ga?.landing || []) gaByPath[l.path.split('?')[0]] = l;

    const pages = [];
    const total = urls.length;
    let done = 0;
    const worker = async () => {
      while (urls.length) {
        const u = urls.shift();
        const f = await fetchUrl(u);
        let path = '/'; try { path = new URL(u).pathname; } catch {}
        // content scoring & keyword gaps use non-branded queries only (SEO is for non-brand demand)
        const res = analyzePage(f, (pqByPage[u] || []).filter((r) => !isBranded(r.q)), gaByPath[path] || null);
        res.gsc = gscPage[u] || null;
        if (moneySet.has(u)) res.money = true;
        pages.push(res);
        done++;
        step(`Crawling pages (${done}/${total})`, 20 + (done / total) * 55);
        log(`${f.status} ${moneySet.has(u) ? '💰 ' : ''}${shortUrl(u)} — on-page ${res.onpage_score}, content ${res.content_score}`, f.status === 200 ? '' : 'no');
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    step('Scoring & finding opportunities', 78);
    const site = siteChecks(pages, robots, sitemap, project.site_url);
    const scores = overallScores(pages, site);
    const opps = opportunities({ ...gsc, prevQueries: prevQ, prevPages: prevP }, ga, pages, isBranded);
    const movers = computeMovers(gsc.queries, prevQ, gsc.pages, prevP, pages, isBranded);
    const navTerms = [
      ...(opt.allGroups || []).map((g) => ({ term: g.name, src: 'LOB', i: 0 })),
      ...gsc.queries.filter((q) => !isBranded(q.q)).sort((a, b) => b.i - a.i).slice(0, 15).map((q) => ({ term: q.q, src: 'Top non-branded query', i: q.i })),
    ];
    const nav = navGaps(pages, project.site_url, navTerms);
    const links = internalLinkPlan(pages, isBranded);
    const renderModes = pages.reduce((a, p) => { if (p.meta?.renderMode) a[p.meta.renderMode] = (a[p.meta.renderMode] || 0) + 1; return a; }, {});
    pages.forEach((p) => delete p._text); // page text is only needed for link matching, not stored
    // AI search / GEO readiness (site level)
    const home = pages.find((p) => p.url === project.site_url && p.meta) || pages.find((p) => p.meta);
    const geoPages = pages.filter((p) => p.geo);
    const gw = (p) => 1 + Math.log10(1 + (p.gsc?.i || 0));
    const pageGeo = geoPages.length ? geoPages.reduce((t, p) => t + p.geo.score * gw(p), 0) / geoPages.reduce((t, p) => t + gw(p), 0) : 0;
    const crawlers = robotsAccess(robots.status === 200 ? robots.html : '');
    const trust = {
      // any crawled page counts (the homepage may be client-rendered)
      about: geoPages.some((p) => p.meta?.trustLinks?.about), contact: geoPages.some((p) => p.meta?.trustLinks?.contact), privacy: geoPages.some((p) => p.meta?.trustLinks?.privacy),
      orgSchema: geoPages.some((p) => (p.meta?.schemaTypes || []).some((t) => /Organization|Corporation|LocalBusiness/i.test(t))), sameAs: Math.max(0, ...geoPages.map((p) => p.meta?.sameAs || 0)),
    };
    const keyBots = crawlers.filter((c) => ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot'].includes(c.bot));
    const siteGeo = (keyBots.filter((c) => c.status === 'Allowed').length / keyBots.length) * 50 + (trust.about + trust.contact + trust.privacy + trust.orgSchema) * 10 + (trust.sameAs ? 10 : 0);
    const geo = { score: Math.round(pageGeo * 0.7 + siteGeo * 0.3), pageScore: Math.round(pageGeo), siteScore: Math.round(siteGeo), crawlers, trust, llms: llms.status === 200 && llms.html ? 'present' : 'absent' };
    const organic = inScope && ga
      ? { cur: { sessions: ga.landing.reduce((s, l) => s + l.sessions, 0), keyEvents: ga.landing.reduce((s, l) => s + l.keyEvents, 0), engagementRate: null }, prev: null }
      : ga?.channels.find((c) => c.name === 'Organic Search');
    const days = Math.round((new Date(run.end) - new Date(run.start)) / 86400000) + 1;
    const summary = {
      days, compare: run.compare || 'previous', scores, site, opps,
      kpis: {
        clicks: gsc.totals.clicks, impressions: gsc.totals.impressions, ctr: gsc.totals.ctr, position: gsc.totals.position,
        prev: gsc.prevTotals, sessions: organic?.cur?.sessions ?? null, prevSessions: organic?.prev?.sessions ?? null,
        keyEvents: organic?.cur?.keyEvents ?? null, prevKeyEvents: organic?.prev?.keyEvents ?? null,
        engagementRate: organic?.cur?.engagementRate ?? null,
      },
      pagesCrawled: pages.length,
      moneyPages: opt.money.length,
      scope: inScope ? (opt.scope === 'all' ? 'All LOB groups' : 'LOB: ' + opt.scope.slice(4)) : null,
      brand: project.brand_terms ? { ...brand, terms: project.brand_terms } : null,
      prevBrand: project.brand_terms ? prevBrand : null,
      movers, navGaps: nav, links, renderModes, geo,
      scopeGroups: inScope ? opt.scopeGroups.map((g) => ({ name: g.name, patterns: g.patterns })) : null,
      full: full && !full.unsaved ? { queries: full.queries.length, pages: full.pages.length, pagequeries: full.pagequeries.length } : null,
    };

    step('Saving results', 82);
    for (let i = 0; i < pages.length; i += 10) await api(`/api/runs/${run.id}/pages`, { method: 'POST', body: { pages: pages.slice(i, i + 10) } });
    await api(`/api/runs/${run.id}/finish`, { method: 'POST', body: { score: scores.overall, summary } });
    log(`Overall score ${scores.overall} (on-page ${scores.onpage}, content ${scores.content}, technical ${scores.technical})`);

    step('Asking AI for recommendations', 88);
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
    period: `${summary.days} days, ${summary.compare === 'year' ? 'compared with the same period last year' : 'compared with the previous period'}`,
    moneyPages: pages.filter((p) => p.money).map((p) => ({ url: p.url, onpage: p.onpage_score, content: p.content_score, clicks: p.gsc?.c, impressions: p.gsc?.i, pos: p.gsc?.p })),
    kpis: { clicks: k.clicks, prevClicks: k.prev?.clicks, impressions: k.impressions, prevImpressions: k.prev?.impressions, ctr: +(k.ctr * 100).toFixed(2), avgPosition: +k.position.toFixed(1), organicSessions: k.sessions, prevOrganicSessions: k.prevSessions, keyEvents: k.keyEvents },
    scores: summary.scores,
    siteChecks: summary.site.checks.filter((c) => c.val < 1).map((c) => `${c.label}: ${c.detail}`),
    scope: summary.scope || 'whole site',
    comparison: (() => {
      const m = summary.movers || computeMovers(gsc.queries, gsc.prevQueries, gsc.pages, gsc.prevPages, pages, brandTester(project.brand_terms));
      const q = (r) => ({ query: r.k, branded: r.b, clicks: r.c, prevClicks: r.pc, pos: r.p, prevPos: r.pp });
      const pg = (r) => ({ url: r.k, clicks: r.c, prevClicks: r.pc, pos: r.p, prevPos: r.pp, onpage: r.onpage, content: r.content });
      return {
        queryStats: m.queryStats, nonBrandedQueryStats: m.nonBrandedStats, pageStats: m.pageStats,
        winnersAvgOnpage: m.winnersAvgOnpage, losersAvgOnpage: m.losersAvgOnpage, losersWithPositionDrop: m.losersWithPosDrop,
        topGainingQueries: m.queriesUp.slice(0, 20).map(q), topLosingQueries: m.queriesDown.slice(0, 20).map(q),
        topGainingPages: m.pagesUp.slice(0, 15).map(pg), topLosingPages: m.pagesDown.slice(0, 15).map(pg),
        prevBrandSplit: summary.prevBrand ? { brandedClicks: summary.prevBrand.branded.c, nonBrandedClicks: summary.prevBrand.nonBranded.c } : undefined,
      };
    })(),
    renderModes: summary.renderModes,
    aiSearchGeo: summary.geo ? {
      score: summary.geo.score, aiCrawlers: summary.geo.crawlers.map((c) => `${c.bot}: ${c.status}`), trustSignals: summary.geo.trust, llmsTxt: summary.geo.llms,
      weakestPages: pages.filter((p) => p.geo).sort((a, b) => (b.gsc?.i || 0) - (a.gsc?.i || 0)).slice(0, 25).filter((p) => p.geo.score < 70).slice(0, 12)
        .map((p) => ({ url: p.url, geoScore: p.geo.score, failing: p.geo.checks.filter((c) => c.val < 1).map((c) => `${c.label} (${c.detail})`) })),
    } : undefined,
    csrPages: pages.filter((p) => p.meta?.renderMode === 'CSR').slice(0, 10).map((p) => ({ url: p.url, framework: p.meta.framework, wordsInHtml: p.meta.wordCount, scripts: p.meta.scripts })),
    internalLinkOpportunities: (summary.links?.suggestions || []).slice(0, 25),
    pagesWithFewInternalLinks: (summary.links?.weakInbound || []).slice(0, 15),
    jsRenderingRisk: pages.filter((p) => p.checks.find((c) => c.id === 'js')?.val === 0).slice(0, 10).map((p) => ({ url: p.url, wordsInHtml: p.meta?.wordCount, scripts: p.meta?.scripts })),
    navigationFooter: summary.navGaps ? { page: summary.navGaps.page, navLinkTexts: (pages.find((p) => p.url === summary.navGaps.page)?.meta?.navLinks || []).slice(0, 40), missingFromNavAndFooter: summary.navGaps.missing.map((r) => r.term) } : undefined,
    brandSplit: summary.brand ? { brandTerms: summary.brand.terms, brandedClicks: summary.brand.branded.c, brandedImpressions: summary.brand.branded.i, nonBrandedClicks: summary.brand.nonBranded.c, nonBrandedImpressions: summary.brand.nonBranded.i } : 'brand terms not set',
    topNonBrandedQueries: gsc.queries.filter((q) => !brandTester(project.brand_terms)(q.q)).slice(0, 60).map((q) => [q.q, q.c, q.i, q.p]),
    topBrandedQueries: project.brand_terms ? gsc.queries.filter((q) => brandTester(project.brand_terms)(q.q)).slice(0, 10).map((q) => [q.q, q.c, q.i, q.p]) : [],
    queryFormat: '[query, clicks, impressions, position]',
    quickWins: summary.opps.quickWins.slice(0, 12).map((q) => ({ q: q.q, i: q.i, pos: q.p, ctr: q.ctr, page: q.page })),
    lowCtr: summary.opps.lowCtr.slice(0, 8).map((q) => ({ q: q.q, pos: q.p, ctr: q.ctr, expected: q.expected, page: q.page })),
    cannibalization: summary.opps.cannibalization.slice(0, 6),
    decliningPages: summary.opps.decliningPages.slice(0, 8).map((p) => ({ url: p.u, clicks: p.c, prevClicks: p.prevC, pos: p.p, prevPos: p.prevP })),
    risingQueries: summary.opps.risingQueries.slice(0, 8).map((q) => [q.q, q.c, q.prevC]),
    lowEngagementLanding: summary.opps.lowEngagement.slice(0, 6),
    devices: gsc.devices,
    pages: [...pages].sort((a, b) => (b.money ? 1 : 0) - (a.money ? 1 : 0)).slice(0, 30).map((p) => ({
      money: !!p.money,
      url: p.url, status: p.status, onpage: p.onpage_score, content: p.content_score, clicks: p.gsc?.c, impressions: p.gsc?.i, pos: p.gsc?.p,
      title: p.meta?.title, description: p.meta?.description, h1: p.meta?.h1s?.[0], words: p.meta?.wordCount, schema: p.meta?.schemaTypes,
      failed: p.checks.filter((c) => c.val < 1).map((c) => c.label + (c.detail ? ` (${c.detail})` : '')).slice(0, 10),
      topQueries: (p.queries || []).slice(0, 8).map((q) => ({ q: q.query, branded: brandTester(project.brand_terms)(q.query), i: q.impressions, clicks: q.clicks, pos: q.position, score: q.score, missingIn: missingSpots(q) })),
      h2s: (p.meta?.subheads || []).slice(0, 10),
      externalLinks: p.meta?.externalLinks, internalLinks: p.meta?.internalLinks,
      ctas: p.meta?.ctas, forms: p.meta?.forms, phoneLinks: p.meta?.telLinks,
      ga: p.ga ? { sessions: p.ga.sessions, users: p.ga.users, engagementRate: p.ga.engagementRate, bounceRate: p.ga.bounceRate, avgDurationSec: p.ga.avgDuration, keyEvents: p.ga.keyEvents, keyEventsPerSession: p.ga.sessions ? +(p.ga.keyEvents / p.ga.sessions).toFixed(3) : 0 } : undefined,
    })),
  };
}

async function requestAi(runId, ctx) {
  return (await api(`/api/runs/${runId}/ai`, { method: 'POST', body: { input: aiInput(ctx) } })).ai;
}

// ---------- LOB report ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const compact = (n) => (n == null ? '' : n >= 1e6 ? fmt(n / 1e6, 2) + 'M' : n >= 1e3 ? fmt(n / 1e3, n >= 1e5 ? 1 : 2) + 'K' : fmt(n));
// src: which stored table the metric comes from; sum: whether values add up across groups/periods
const METRICS = {
  clicks: { label: 'Clicks', src: 'gsc', get: (r) => r.clicks, fmt: compact, sum: true },
  impressions: { label: 'Impressions', src: 'gsc', get: (r) => r.impressions, fmt: compact, sum: true },
  ctr: { label: 'CTR', src: 'gsc', get: (r) => r.ctr, fmt: (v) => pct(v, 2), sum: false },
  position: { label: 'Avg position', src: 'gsc', get: (r) => r.position, fmt: (v) => fmt(v, 1), sum: false, invert: true },
  sessions: { label: 'Organic sessions (GA4)', src: 'ga', get: (r) => r.sessions, fmt: compact, sum: true },
  new_users: { label: 'New users (GA4)', src: 'ga', get: (r) => r.new_users, fmt: compact, sum: true },
  returning: { label: 'Returning users (GA4)', src: 'ga', get: (r) => Math.max(0, r.total_users - r.new_users), fmt: compact, sum: true },
  views: { label: 'Page views (GA4)', src: 'ga', get: (r) => r.views, fmt: compact, sum: true },
  bounce: { label: 'Bounce rate (GA4)', src: 'ga', get: (r) => (r.sessions ? r.bounce_sessions / r.sessions : 0), fmt: (v) => pct(v, 1), sum: false, invert: true },
  key_events: { label: 'Key events (GA4)', src: 'ga', get: (r) => r.key_events, fmt: compact, sum: true },
  leads: { label: 'Leads (GA4)', src: 'ga', get: (r) => r.leads, fmt: compact, sum: true },
};
// Google-Sheets style red → yellow → green scale
function heat(t) {
  const lerp = (a, b, x) => Math.round(a + (b - a) * x);
  const [r, y, g] = [[230, 124, 115], [255, 214, 102], [87, 187, 138]];
  const [a, b, x] = t < 0.5 ? [r, y, t * 2] : [y, g, (t - 0.5) * 2];
  return `rgb(${lerp(a[0], b[0], x)},${lerp(a[1], b[1], x)},${lerp(a[2], b[2], x)})`;
}
function combine(list) {
  const c = list.reduce((s, r) => s + (r.clicks || 0), 0), i = list.reduce((s, r) => s + (r.impressions || 0), 0);
  return { clicks: c, impressions: i, ctr: i ? c / i : 0, position: i ? list.reduce((s, r) => s + (r.position || 0) * (r.impressions || 0), 0) / i : 0 };
}
function combineGa(list) {
  const out = { sessions: 0, new_users: 0, total_users: 0, views: 0, key_events: 0, leads: 0, bounce_sessions: 0 };
  for (const r of list) for (const k in out) out[k] += r[k] || 0;
  return out;
}
function weekRange(key) {
  const [y, w] = key.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (w - 1) * 7 * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const f = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${f(mon)}–${f(sun)}`;
}

async function renderLob(pid, params) {
  const year = Number(params.year) || new Date().getFullYear();
  const view = params.view === 'week' ? 'week' : 'month';
  const [{ project }, data] = await Promise.all([api('/api/projects/' + pid), api(`/api/projects/${pid}/lobs?year=${year}`)]);
  const metricKeys = Object.keys(METRICS).filter((k) => METRICS[k].src === 'gsc' || (data.hasGa && (k !== 'leads' || project.lead_event)));
  const metric = metricKeys.includes(params.metric) ? params.metric : 'clicks';
  const M = METRICS[metric];
  const cats = [...new Set(data.groups.map((g) => g.category).filter(Boolean))];
  const cat = cats.includes(params.cat) ? params.cat : '';
  const groups = data.groups.filter((g) => !cat || g.category === cat);
  const src = M.src === 'ga' ? data.ga.map((r) => ({ ...r, month: r.period })) : data.rows;
  const byKey = {};
  for (const r of src) byKey[r.group_id + '|' + r.month] = r;
  const merge = M.src === 'ga' ? combineGa : combine;

  let cols;
  if (view === 'week') {
    const weeks = [...new Set(data.rows.map((r) => r.month).filter((k) => k.includes('-W') && k.startsWith(year + '-')))].sort();
    cols = weeks.slice(-13).map((k) => ({ key: k, label: k.slice(5), sub: weekRange(k), full: 7 }));
  } else {
    cols = MONTHS.map((m, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      return { key, label: `${m} ${year}`, full: new Date(year, i + 1, 0).getDate() };
    });
  }
  const partial = (c) => { const r = data.rows.find((x) => x.month === c.key); return r && r.days < c.full; };
  // run-rate: for an incomplete month/week, project the total from the days with data so far
  const daysFor = (gid, key) => byKey[gid + '|' + key]?.days || 0;
  const projected = (v, gid, c) => { const d = daysFor(gid, c.key); return v != null && M.sum && d && d < c.full ? (v / d) * c.full : null; };
  const setQ = (k, v) => { const q = { ...params, [k]: v }; if (!v) delete q[k]; delete q.error; location.hash = `#/p/${pid}/lob?` + new URLSearchParams(q); };
  const lastUpdated = Math.max(0, ...data.rows.map((r) => r.updated_at || 0));

  const rowCells = (vals, gid) => {
    const nums = vals.filter((v) => v != null);
    const min = Math.min(...nums), max = Math.max(...nums);
    return vals.map((v, i) => {
      if (v == null) return '<td class="num lob-cell"></td>';
      let t = max > min ? (v - min) / (max - min) : 0.5;
      if (M.invert) t = 1 - t;
      const est = gid ? projected(v, gid, cols[i]) : null;
      return `<td class="num lob-cell" style="background:${heat(t)};color:#1a1a1a">${M.fmt(v)}${est ? `<div style="font-weight:500;font-size:11px">→ ~${M.fmt(est)} est.</div>` : ''}</td>`;
    }).join('');
  };
  const total = (list) => (M.sum ? list.reduce((s, r) => s + M.get(r), 0) : M.get(merge(list)));
  const lines = groups.map((g) => {
    const recs = cols.map((c) => byKey[g.id + '|' + c.key]);
    const have = recs.filter(Boolean);
    return { g, vals: recs.map((r) => (r ? M.get(r) : null)), tot: have.length ? total(have) : null };
  });
  const totVals = cols.map((c) => { const recs = groups.map((g) => byKey[g.id + '|' + c.key]).filter(Boolean); return recs.length ? M.get(merge(recs)) : null; });
  const siteVals = cols.map((c) => (byKey['__site__|' + c.key] ? M.get(byKey['__site__|' + c.key]) : null));
  const allRecs = groups.flatMap((g) => cols.map((c) => byKey[g.id + '|' + c.key]).filter(Boolean));
  const allTot = allRecs.length ? total(allRecs) : null;
  const siteRecs = cols.map((c) => byKey['__site__|' + c.key]).filter(Boolean);
  const pathText = (p) => esc(p).replace(/\n/g, '<br>');
  const lastVsPrev = (vals, gid) => {
    const idx = vals.map((x, i) => (x != null ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return '';
    const li = idx[idx.length - 1], pi = idx[idx.length - 2];
    const est = gid ? projected(vals[li], gid, cols[li]) : null;
    return delta(est ?? vals[li], vals[pi], { invert: M.invert }) + (est ? '<div class="small muted">run-rate</div>' : '');
  };

  app.innerHTML = `<div class="row spread"><div><div class="small"><a href="#/p/${pid}">← ${esc(project.name)}</a></div><h1>LOB report</h1>
      <div class="muted small">${esc(project.gsc_property)}${data.hasGa ? ' · GA4: ' + esc(project.ga4_name || '') + ' (organic)' : ''}${lastUpdated ? ' · updated ' + date(lastUpdated) : ''}</div></div>
      <div class="row">
        <div class="seg"><button class="${view === 'month' ? 'on' : ''}" data-view="month">Monthly</button><button class="${view === 'week' ? 'on' : ''}" data-view="week">Weekly</button></div>
        <select id="lob-year" style="width:auto">${[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <select id="lob-metric" style="width:auto">${metricKeys.map((k) => `<option value="${k}" ${k === metric ? 'selected' : ''}>${METRICS[k].label}</option>`).join('')}</select>
        <button class="btn" id="lob-csv">⬇ CSV</button>
        ${data.isAdmin ? '<button class="btn" id="lob-edit">✏️ Edit groups</button>' : ''}
        ${data.canRun && data.groups.length ? `<button class="btn primary" id="lob-refresh">⟳ Refresh ${data.hasGa ? 'GSC + GA4' : 'from GSC'}</button>` : ''}
      </div></div>
    ${cats.length ? `<div class="tabs">${['', ...cats].map((c) => `<button class="tab ${c === cat ? 'active' : ''}" data-cat="${esc(c)}">${c ? esc(c) : 'Overall'}</button>`).join('')}</div>` : '<div style="height:16px"></div>'}
    <div id="lob-progress" class="hidden card" style="margin-bottom:12px"><b id="lob-pstep">Refreshing…</b><div class="progress"><div id="lob-pbar" style="width:3%"></div></div></div>
    ${!data.groups.length ? `<div class="card center"><h2>No URL groups yet</h2><p class="muted">Add your LOBs (e.g. Broadband Blog → <code>/blog/broadband/</code>) to get a monthly report like your Sheet.</p>
        ${data.isAdmin ? '<button class="btn primary" id="lob-edit2">+ Add URL groups</button>' : '<p class="muted small">Ask your admin to set up the groups.</p>'}</div>`
    : `<div class="card" style="padding:0"><div class="table-wrap"><table class="lob">
      <thead><tr><th>URLs grouped</th><th>Page path</th>${cols.map((c) => `<th class="num" title="${esc(c.sub || '')}">${c.label}${partial(c) ? ' *' : ''}${c.sub ? `<div style="font-weight:400;font-size:10px">${c.sub}</div>` : ''}</th>`).join('')}<th class="num">${M.sum ? 'Total' : 'All'}</th><th class="num">Last vs prev</th></tr></thead>
      <tbody>${lines.map((l) => `<tr><td><b>${esc(l.g.name)}</b>${!cat && l.g.category ? `<div class="small muted">${esc(l.g.category)}</div>` : ''}</td><td class="small muted lob-path">${pathText(l.g.patterns)}</td>${rowCells(l.vals, l.g.id)}<td class="num"><b>${l.tot == null ? '' : M.fmt(l.tot)}</b></td><td class="num">${lastVsPrev(l.vals, l.g.id)}</td></tr>`).join('')}
        <tr class="lob-total"><td colspan="2">Total (${cat || 'all groups'})</td>${totVals.map((v) => `<td class="num">${v == null ? '' : M.fmt(v)}</td>`).join('')}<td class="num">${allTot == null ? '' : M.fmt(allTot)}</td><td></td></tr>
        ${!cat ? `<tr class="lob-site"><td colspan="2">Whole site</td>${siteVals.map((v, i) => { const e = projected(v, '__site__', cols[i]); return `<td class="num">${v == null ? '' : M.fmt(v)}${e ? `<div class="small">→ ~${M.fmt(e)} est.</div>` : ''}</td>`; }).join('')}<td class="num">${siteRecs.length ? M.fmt(total(siteRecs)) : ''}</td><td class="num">${lastVsPrev(siteVals, '__site__')}</td></tr>` : ''}
      </tbody></table></div></div>
      <p class="hint">Colours compare ${view === 'week' ? 'weeks' : 'months'} within each row (red = lowest, green = highest${M.invert ? '; lower is better here' : ''}). * = not complete yet; “→ ~X est.” is the run-rate (so far ÷ days with data × days in the ${view}), and “Last vs prev” uses it. "Last vs prev" compares the latest ${view} with the one before.
      Totals add up the groups, so a URL in two groups is counted twice — compare with "Whole site". GA4 numbers are organic sessions by landing page.
      ${data.rows.length ? '' : '<br><b>No data yet — click “Refresh”.</b>'} Every refresh is saved, so history beyond Search Console's 16 months stays here.</p>`}`;

  document.getElementById('lob-year').onchange = (e) => setQ('year', e.target.value);
  document.getElementById('lob-metric').onchange = (e) => setQ('metric', e.target.value === 'clicks' ? '' : e.target.value);
  app.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setQ('view', b.dataset.view === 'week' ? 'week' : '')));
  app.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => setQ('cat', b.dataset.cat)));
  const edit = () => lobEditor(pid, data.groups);
  document.getElementById('lob-edit')?.addEventListener('click', edit);
  document.getElementById('lob-edit2')?.addEventListener('click', edit);
  document.getElementById('lob-csv').onclick = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [['Group', 'Category', 'Page path', ...cols.map((c) => c.label + (c.sub ? ` (${c.sub})` : '')), 'Total'].map(q).join(','),
      ...lines.map((l) => [l.g.name, l.g.category, l.g.patterns, ...l.vals.map((v) => v ?? ''), l.tot ?? ''].map(q).join(',')),
      ['Total', cat, '', ...totVals.map((v) => v ?? ''), allTot ?? ''].map(q).join(',')].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${project.name}-LOB-${metric}-${view}-${year}${cat ? '-' + cat : ''}.csv`;
    a.click();
  };
  document.getElementById('lob-refresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    document.getElementById('lob-progress').classList.remove('hidden');
    const ids = data.groups.map((g) => g.id);
    const step = data.hasGa ? 5 : 8;
    try {
      for (let i = 0; i < ids.length; i += step) {
        document.getElementById('lob-pstep').textContent = `Fetching groups ${i + 1}–${Math.min(ids.length, i + step)} of ${ids.length}…`;
        document.getElementById('lob-pbar').style.width = ((i + 1) / ids.length) * 100 + '%';
        await api(`/api/projects/${pid}/lobs/refresh`, { method: 'POST', body: { year, groupIds: ids.slice(i, i + step), includeSite: i === 0 } });
      }
      toast('Updated');
      route();
    } catch (err) {
      toast(err.message, 7000);
      e.target.disabled = false;
      document.getElementById('lob-progress').classList.add('hidden');
    }
  });
}

// ---------- URL performance (GSC + GA4 per URL, weekly / monthly) ----------
const GA_COLS = ['sessions', 'newUsers', 'totalUsers', 'bounceRate', 'views', 'keyEvents', 'leads'];
const dayMs = 86400000;
function perfPeriods(gran) {
  const lastData = new Date(Date.now() - 3 * dayMs);
  const out = [];
  if (gran === 'week') {
    const mon = new Date(Date.UTC(lastData.getUTCFullYear(), lastData.getUTCMonth(), lastData.getUTCDate()) - ((lastData.getUTCDay() + 6) % 7) * dayMs);
    for (let i = 0; i < 12; i++) {
      const s = new Date(mon.getTime() - i * 7 * dayMs), e = new Date(s.getTime() + 6 * dayMs);
      const end = e > lastData ? lastData : e;
      out.push({ key: isoDay(s), start: isoDay(s), end: isoDay(end), partial: e > lastData, label: `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` });
    }
  } else {
    for (let i = 0; i < 13; i++) {
      const s = new Date(Date.UTC(lastData.getUTCFullYear(), lastData.getUTCMonth() - i, 1));
      const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
      const end = e > lastData ? lastData : e;
      out.push({ key: isoDay(s).slice(0, 7), start: isoDay(s), end: isoDay(end), partial: e > lastData, label: s.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
    }
  }
  return out;
}
function comparePeriod(p, gran, cmp) {
  const s = new Date(p.start + 'T00:00:00Z'), e = new Date(p.end + 'T00:00:00Z');
  const len = Math.round((e - s) / dayMs);
  if (cmp === 'year') {
    if (gran === 'week') return { start: isoDay(new Date(s - 364 * dayMs)), end: isoDay(new Date(e - 364 * dayMs)) };
    const ps = new Date(s); ps.setUTCFullYear(ps.getUTCFullYear() - 1);
    return { start: isoDay(ps), end: isoDay(new Date(ps.getTime() + len * dayMs)) };
  }
  if (gran === 'week') return { start: isoDay(new Date(s - 7 * dayMs)), end: isoDay(new Date(e - 7 * dayMs)) };
  const ps = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1));
  const pe = p.partial ? new Date(ps.getTime() + len * dayMs) : new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 0));
  return { start: isoDay(ps), end: isoDay(pe) };
}

async function projGsc(pid, body, cap = 100000) {
  const rows = [];
  for (let startRow = 0; startRow < cap; startRow += 25000) {
    const res = await fetch(`/api/projects/${pid}/gsc-rows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, rowLimit: 25000, startRow }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error?.message || d.error || 'Search Console request failed');
    rows.push(...(d.rows || []));
    if ((d.rows || []).length < 25000) break;
  }
  return rows;
}
async function projGa(pid, body) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 25000) {
    const res = await fetch(`/api/projects/${pid}/ga-rows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, limit: 25000, offset }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error?.message || d.error || 'GA4 request failed');
    rows.push(...(d.rows || []));
    if ((d.rows || []).length < 25000) break;
  }
  return rows.map((r) => {
    const v = r.metricValues.map((x) => Number(x.value || 0));
    return { path: r.dimensionValues[0].value.split('?')[0], sessions: v[0], newUsers: v[1], totalUsers: v[2], bounceRate: v[3], views: v[4], keyEvents: v[5], leads: v[6] || 0 };
  });
}

const perfCache = {};
async function renderUrls(pid, params) {
  const gran = params.gran === 'week' ? 'week' : 'month';
  const cmp = params.cmp === 'year' ? 'year' : 'prev';
  const organic = true; // GA4 is always Organic Search only
  const [{ project }, lob] = await Promise.all([api('/api/projects/' + pid), api(`/api/projects/${pid}/lobs`)]);
  const periods = perfPeriods(gran);
  const per = periods.find((p) => p.key === params.p) || periods[gran === 'month' && periods[0].partial ? 1 : 0];
  const prev = comparePeriod(per, gran, cmp);
  const cats = [...new Set(lob.groups.map((g) => g.category).filter(Boolean))];
  const scope = params.lob || '';
  const scoped = scope.startsWith('cat:') ? lob.groups.filter((g) => g.category === scope.slice(4)) : scope.startsWith('g:') ? lob.groups.filter((g) => g.id === scope.slice(2)) : scope === 'all' ? lob.groups : [];
  const groupIds = scoped.map((g) => g.id);
  const matchAll = lobMatcher(lob.groups);
  const matchScope = scoped.length ? lobMatcher(scoped) : null;
  const isBranded = brandTester(project.brand_terms);
  const setQ = (k, v) => { const q = { ...params, [k]: v }; if (!v) delete q[k]; delete q.error; location.hash = `#/p/${pid}/urls?` + new URLSearchParams(q); };

  app.innerHTML = `<div class="row spread"><div><div class="small"><a href="#/p/${pid}">← ${esc(project.name)}</a></div><h1>URL performance</h1>
      <div class="muted small">Search Console + GA4 per URL · ${esc(per.start)} → ${esc(per.end)}${per.partial ? ' (so far)' : ''} vs ${esc(prev.start)} → ${esc(prev.end)}</div></div>
      <div class="row">
        <div class="seg"><button class="${gran === 'month' ? 'on' : ''}" data-gran="month">Monthly</button><button class="${gran === 'week' ? 'on' : ''}" data-gran="week">Weekly</button></div>
        <select id="u-per" style="width:auto">${periods.map((p) => `<option value="${p.key}" ${p.key === per.key ? 'selected' : ''}>${esc(p.label)}${p.partial ? ' (so far)' : ''}</option>`).join('')}</select>
        <select id="u-cmp" style="width:auto"><option value="prev">vs previous ${gran}</option><option value="year" ${cmp === 'year' ? 'selected' : ''}>vs same ${gran} last year</option></select>
        <select id="u-lob" style="width:auto"><option value="">All URLs</option>${lob.groups.length ? `<option value="all" ${scope === 'all' ? 'selected' : ''}>All LOB groups</option>` : ''}
          ${cats.map((c) => `<option value="cat:${esc(c)}" ${scope === 'cat:' + c ? 'selected' : ''}>LOB: ${esc(c)}</option>`).join('')}
          ${lob.groups.map((g) => `<option value="g:${g.id}" ${scope === 'g:' + g.id ? 'selected' : ''}>— ${esc(g.name)}</option>`).join('')}</select>
        <button class="btn" id="u-csv">⬇ CSV</button>
      </div></div>
    ${project.brand_terms ? '' : `<div class="banner">Tip: add your <b>brand terms</b> (e.g. <code>airtel</code>) in ${isAdmin() ? `<a href="#/p/${pid}/edit">project settings</a>` : 'project settings (ask your admin)'} to split branded vs non-branded queries.</div>`}
    <div id="u-body" class="card section center muted">Loading Search Console${project.ga4_property ? ' and GA4' : ''} data…</div>`;

  app.querySelectorAll('[data-gran]').forEach((b) => (b.onclick = () => { const q = { ...params, gran: b.dataset.gran }; delete q.p; location.hash = `#/p/${pid}/urls?` + new URLSearchParams(q); }));
  document.getElementById('u-per').onchange = (e) => setQ('p', e.target.value);
  document.getElementById('u-cmp').onchange = (e) => setQ('cmp', e.target.value === 'year' ? 'year' : '');
  document.getElementById('u-lob').onchange = (e) => setQ('lob', e.target.value);

  const key = JSON.stringify([pid, per.start, per.end, prev, groupIds, organic]);
  let d = perfCache[key];
  try {
    if (!d) {
      const q = (r) => ({ startDate: r.start, endDate: r.end, groupIds });
      const [gc, gp, qc, qp, ac, ap] = await Promise.all([
        projGsc(pid, { ...q(per), dimensions: ['page'] }),
        projGsc(pid, { ...q(prev), dimensions: ['page'] }),
        projGsc(pid, { ...q(per), dimensions: ['query'] }, 50000),
        projGsc(pid, { ...q(prev), dimensions: ['query'] }, 50000),
        project.ga4_property ? projGa(pid, { ...q(per), organicOnly: organic }) : [],
        project.ga4_property ? projGa(pid, { ...q(prev), organicOnly: organic }) : [],
      ]);
      d = perfCache[key] = { gc, gp, qc, qp, ac, ap };
    }
  } catch (e) {
    document.getElementById('u-body').innerHTML = `<div class="banner err">${esc(e.message)}</div>`;
    return;
  }
  const origin = new URL(project.site_url).origin;
  const inScope = (url) => !matchScope || !!matchScope(url);
  const rows = {};
  const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };
  const get = (p) => (rows[p] ||= { path: p, url: origin + p, c: 0, i: 0, pw: 0, pc: 0, pi: 0, ppw: 0, ga: null, pga: null, best: -1 });
  for (const [list, pre] of [[d.gc, ''], [d.gp, 'p']]) {
    for (const r of list) {
      const u = r.keys[0];
      if (!inScope(u)) continue;
      const x = get(pathOf(u));
      if (!pre && r.clicks > x.best) { x.best = r.clicks; x.url = u; }
      x[pre + 'c'] += r.clicks; x[pre + 'i'] += r.impressions; x[pre + 'pw'] += r.position * r.impressions;
    }
  }
  const addGa = (list, field) => {
    for (const r of list) {
      if (!inScope(origin + r.path)) continue;
      const x = get(r.path);
      const t = (x[field] ||= { sessions: 0, newUsers: 0, totalUsers: 0, bounced: 0, views: 0, keyEvents: 0, leads: 0 });
      t.sessions += r.sessions; t.newUsers += r.newUsers; t.totalUsers += r.totalUsers; t.bounced += r.bounceRate * r.sessions; t.views += r.views; t.keyEvents += r.keyEvents; t.leads += r.leads;
    }
  };
  addGa(d.ac, 'ga'); addGa(d.ap, 'pga');
  const list = Object.values(rows).map((x) => ({
    ...x, lob: matchAll(x.url)?.name || '', ctr: x.i ? x.c / x.i : 0, p: x.i ? x.pw / x.i : null, pctr: x.pi ? x.pc / x.pi : 0, pp: x.pi ? x.ppw / x.pi : null,
    s: x.ga?.sessions || 0, ps: x.pga?.sessions || 0, nu: x.ga?.newUsers || 0, ru: x.ga ? Math.max(0, x.ga.totalUsers - x.ga.newUsers) : 0,
    br: x.ga?.sessions ? x.ga.bounced / x.ga.sessions : null, pbr: x.pga?.sessions ? x.pga.bounced / x.pga.sessions : null,
    pv: x.ga?.views || 0, ke: x.ga?.keyEvents || 0, pke: x.pga?.keyEvents || 0, ld: x.ga?.leads || 0, pld: x.pga?.leads || 0,
    pnu: x.pga?.newUsers || 0, pru: x.pga ? Math.max(0, x.pga.totalUsers - x.pga.newUsers) : 0, ppv: x.pga?.views || 0,
  })).filter((x) => x.c || x.i || x.s || x.pc || x.ps).sort((a, b) => b.c - a.c || b.s - a.s);

  const sum = (k) => list.reduce((t, x) => t + (x[k] || 0), 0);
  const scopedQ = (qs) => qs.map((r) => ({ q: r.keys[0], c: r.clicks, i: r.impressions }));
  const bs = brandSplit(scopedQ(d.qc), isBranded), pbs = brandSplit(scopedQ(d.qp), isBranded);
  const tile = (label, v, pv, f = fmt, opt = {}) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${f(v)}</div>${delta(v, pv, opt) || '<span class="delta muted">&nbsp;</span>'}</div>`;
  const hasGa = !!project.ga4_property, hasLead = !!project.lead_event;
  const totS = sum('s'), totB = list.reduce((t, x) => t + (x.ga?.bounced || 0), 0), ptotS = sum('ps'), ptotB = list.reduce((t, x) => t + (x.pga?.bounced || 0), 0);
  CMP.cur = per.label; CMP.prev = gran === 'month' ? periodLabel(prev.start, prev.end) : periodLabel(prev.start, prev.end);
  const cell = dcell;

  document.getElementById('u-body').outerHTML = `<div class="grid kpis section">
      ${tile('Clicks', sum('c'), sum('pc'))}${tile('Impressions', sum('i'), sum('pi'))}
      ${project.brand_terms ? tile('Non-branded clicks', bs.nonBranded.c, pbs.nonBranded.c) + tile('Branded clicks', bs.branded.c, pbs.branded.c) : ''}
      ${hasGa ? tile('Organic sessions', totS, ptotS) + tile('New users', sum('nu'), sum('pnu')) + tile('Returning users', sum('ru'), sum('pru')) + tile('Bounce rate', totS ? totB / totS : 0, ptotS ? ptotB / ptotS : 0, (v) => pct(v), { invert: true, isPct: true }) + tile('Page views', sum('pv'), sum('ppv')) + tile('Key events', sum('ke'), sum('pke')) : ''}
      ${hasLead ? tile(`Leads (${esc(project.lead_event)})`, sum('ld'), sum('pld')) : ''}
    </div>
    ${project.brand_terms ? `<div class="small muted" style="margin-top:6px">Branded = queries containing ${esc(project.brand_terms)} · non-branded share of clicks: <b>${pct(bs.nonBranded.c / Math.max(1, bs.nonBranded.c + bs.branded.c))}</b>${groupIds.length ? ' · query split is for the selected LOB URLs' : ''}</div>` : ''}
    <div class="card section">${catView('urls', list, (x) => x.url, [
      { label: 'Clicks', cur: (x) => x.c, prev: (x) => x.pc }, { label: 'Impressions', cur: (x) => x.i, prev: (x) => x.pi },
      ...(hasGa ? [{ label: 'Organic sessions', cur: (x) => x.s, prev: (x) => x.ps }] : []),
    ], (list) => table([
      { key: 'cat', label: 'Category', render: (x) => `<span class="small">${esc(x.__cat.label)}</span>`, sort: (x) => x.__cat.label },
      { key: 'path', label: 'URL', render: (x) => `<span class="url">${esc(x.path)}</span>${x.lob ? `<div class="small muted">${esc(x.lob)}</div>` : ''}`, text: (x) => x.path + ' ' + x.lob },
      { key: 'c', label: 'Clicks', num: 1, render: (x) => cell(x.c, x.pc) },
      { key: 'i', label: 'Impr.', num: 1, render: (x) => cell(x.i, x.pi) },
      { key: 'ctr', label: 'CTR', num: 1, render: (x) => cell(x.ctr, x.pctr, (v) => pct(v), { isPct: true }) },
      { key: 'p', label: 'Pos', num: 1, render: (x) => cell(x.p, x.pp, (v) => fmt(v, 1), { invert: true }), sort: (x) => x.p ?? 999 },
      ...(hasGa ? [
        { key: 's', label: 'Sessions', num: 1, render: (x) => cell(x.s, x.ps) },
        { key: 'nu', label: 'New users', num: 1, render: (x) => cell(x.nu, x.pnu) },
        { key: 'ru', label: 'Returning', num: 1, render: (x) => cell(x.ru, x.pru) },
        { key: 'br', label: 'Bounce', num: 1, render: (x) => (x.br == null ? '–' : cell(x.br, x.pbr, (v) => pct(v), { invert: true, isPct: true })), sort: (x) => x.br ?? -1 },
        { key: 'pv', label: 'Views', num: 1, render: (x) => cell(x.pv, x.ppv) },
        { key: 'ke', label: 'Key events', num: 1, render: (x) => cell(x.ke, x.pke) },
      ] : []),
      ...(hasLead ? [{ key: 'ld', label: 'Leads', num: 1, render: (x) => cell(x.ld, x.pld) }] : []),
    ], list, { limit: 1000, onRow: (x) => urlQueries(pid, project, x, per, prev, isBranded) }))}
    <p class="hint">${fmt(list.length)} URLs. Click a URL to see all its queries (branded vs non-branded). GSC URLs are matched to GA4 organic landing pages by path (GA4 = Organic Search only). ${hasGa ? 'Returning users = total users − new users.' : ''}</p></div>`;

  document.getElementById('u-csv').onclick = () => {
    const qv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['URL', 'LOB', 'Clicks', 'Prev clicks', 'Impressions', 'Prev impressions', 'CTR', 'Position', 'Prev position', ...(hasGa ? ['Sessions', 'Prev sessions', 'New users', 'Returning users', 'Bounce rate', 'Page views', 'Key events', 'Prev key events'] : []), ...(hasLead ? ['Leads', 'Prev leads'] : [])];
    const lines = list.map((x) => [x.url, x.lob, x.c, x.pc, x.i, x.pi, x.ctr.toFixed(4), x.p?.toFixed(1), x.pp?.toFixed(1), ...(hasGa ? [x.s, x.ps, x.nu, x.ru, x.br?.toFixed(4), x.pv, x.ke, x.pke] : []), ...(hasLead ? [x.ld, x.pld] : [])]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head, ...lines].map((l) => l.map(qv).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `${project.name}-urls-${per.start}-${per.end}.csv`;
    a.click();
  };
}

async function urlQueries(pid, project, x, per, prev, isBranded) {
  openDrawer(`<h2 style="word-break:break-all"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a></h2><p class="muted">Loading queries…</p>`);
  try {
    const [cur, old] = await Promise.all([
      projGsc(pid, { startDate: per.start, endDate: per.end, dimensions: ['query'], page: x.url }, 25000),
      projGsc(pid, { startDate: prev.start, endDate: prev.end, dimensions: ['query'], page: x.url }, 25000),
    ]);
    const p = Object.fromEntries(old.map((r) => [r.keys[0], r]));
    const rows = cur.map((r) => ({ q: r.keys[0], c: r.clicks, i: r.impressions, ctr: r.ctr, pos: r.position, pc: p[r.keys[0]]?.clicks ?? 0, pi: p[r.keys[0]]?.impressions ?? 0, ppos: p[r.keys[0]]?.position ?? null, b: isBranded(r.keys[0]) }))
      .sort((a, b) => a.b - b.b || b.i - a.i); // non-branded first
    const split = brandSplit(rows, (q) => isBranded(q));
    const tot = split.branded.c + split.nonBranded.c;
    const curL = periodLabel(per.start, per.end), prevL = periodLabel(prev.start, prev.end);
    const qTable = (list) => table([
      { key: 'q', label: 'Query', render: (r) => `${esc(r.q)} ${r.b ? '<span class="pill info">Branded</span>' : '<span class="pill good">Non-branded</span>'}`, text: (r) => r.q },
      { key: 'c', label: `Clicks ${esc(curL)}`, num: 1, render: (r) => fmt(r.c) },
      { key: 'pc', label: esc(prevL), num: 1, render: (r) => `<span class="muted">${fmt(r.pc)}</span>` },
      { key: 'd', label: 'Δ', num: 1, render: (r) => `${delta(r.c, r.pc) || '<span class="muted">new</span>'}`, sort: (r) => r.c - r.pc },
      { key: 'i', label: 'Impr.', num: 1, render: (r) => `${fmt(r.i)} <div class="small">${delta(r.i, r.pi)}</div>` },
      { key: 'ctr', label: 'CTR', num: 1, render: (r) => pct(r.ctr) },
      { key: 'pos', label: 'Pos', num: 1, render: (r) => `${fmt(r.pos, 1)} <span class="small muted">(${r.ppos == null ? '–' : fmt(r.ppos, 1)})</span>` },
    ], list, { limit: 2000 });
    openDrawer(`<h2 style="word-break:break-all"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a></h2>
      <div class="muted small">${esc(curL)} vs ${esc(prevL)}${x.lob ? ' · LOB: ' + esc(x.lob) : ''}</div>
      <div class="grid kpis section">
        <div class="card kpi"><div class="label">Non-branded clicks</div><div class="value">${fmt(split.nonBranded.c)}</div><span class="small muted">${pct(split.nonBranded.c / Math.max(1, tot))} · ${fmt(split.nonBranded.n)} queries</span></div>
        <div class="card kpi"><div class="label">Branded clicks</div><div class="value">${fmt(split.branded.c)}</div><span class="small muted">${pct(split.branded.c / Math.max(1, tot))} · ${fmt(split.branded.n)} queries</span></div>
        ${x.ga ? `<div class="card kpi"><div class="label">Organic sessions</div><div class="value">${fmt(x.s)}</div><span class="small muted">bounce ${pct(x.br)} · ${fmt(x.ke)} key events</span></div>` : ''}
      </div>
      ${project.brand_terms ? '' : '<div class="banner">Add brand terms in project settings to tag branded queries.</div>'}
      <div class="card section"><div class="seg" style="margin-bottom:12px"><button class="on" data-qf="nb">Non-branded (${fmt(split.nonBranded.n)})</button><button data-qf="b">Branded (${fmt(split.branded.n)})</button><button data-qf="all">All</button></div>
        <div id="qf-box">${qTable(rows.filter((r) => !r.b))}</div><p class="hint">Brackets show the ${esc(prevL)} position.</p></div>`);
    document.querySelectorAll('[data-qf]').forEach((btn) => (btn.onclick = () => {
      document.querySelectorAll('[data-qf]').forEach((x2) => x2.classList.toggle('on', x2 === btn));
      const f = btn.dataset.qf;
      document.getElementById('qf-box').innerHTML = qTable(rows.filter((r) => (f === 'all' ? true : f === 'b' ? r.b : !r.b)));
    }));
  } catch (e) {
    openDrawer(`<div class="banner err">${esc(e.message)}</div>`);
  }
}

function lobEditor(pid, groups) {
  let list = groups.map((g) => ({ ...g }));
  const draw = () => {
    openDrawer(`<h2>URL groups (LOBs)</h2>
      <p class="muted small">One group per LOB. <b>Page path</b>: one rule per line —
        <code>/blog/broadband/</code> = URL contains it · <code>https://site.com/page</code> = exact URL ·
        <code>regex:...</code> = regex · start a line with <code>!</code> to exclude (e.g. <code>!/hindi/</code>). <b>Category</b> makes the tabs (BB, Postpaid, Prepaid…).</p>
      <details class="card" style="margin:12px 0"><summary><b>📋 Paste from Google Sheets</b></summary>
        <p class="small muted">Copy two or three columns from your sheet (Name, Page path, optional Category) and paste them here. Each row becomes a group.</p>
        <textarea id="bulk" rows="6" placeholder="Broadband Blog&#9;/blog/broadband/&#9;BB"></textarea>
        <div class="row" style="margin-top:8px"><input id="bulk-cat" placeholder="Category for rows without one (optional)" style="flex:1"><button class="btn" id="bulk-add">Add rows</button></div>
      </details>
      <div id="glist">${list.map((g, i) => `<div class="card" style="margin-bottom:10px;padding:12px">
        <div class="row" style="flex-wrap:nowrap"><input data-f="name" data-i="${i}" value="${esc(g.name)}" placeholder="Group name" style="flex:2">
          <input data-f="category" data-i="${i}" value="${esc(g.category || '')}" placeholder="Category" style="flex:1">
          <button class="btn sm" data-up="${i}" title="Move up">↑</button><button class="btn sm danger" data-rm="${i}" title="Remove">✕</button></div>
        <textarea data-f="patterns" data-i="${i}" rows="2" placeholder="/blog/broadband/" style="margin-top:8px">${esc(g.patterns)}</textarea></div>`).join('')}</div>
      <div class="row"><button class="btn" id="g-add">+ Add group</button><span style="flex:1"></span><button class="btn primary" id="g-save">Save groups</button></div>`);
    const panel = document.getElementById('drawer-panel');
    panel.querySelectorAll('[data-f]').forEach((el) => (el.oninput = () => (list[el.dataset.i][el.dataset.f] = el.value)));
    panel.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { list.splice(+b.dataset.rm, 1); draw(); }));
    panel.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { const i = +b.dataset.up; if (i) [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); }));
    document.getElementById('g-add').onclick = () => { list.push({ name: '', category: '', patterns: '' }); draw(); };
    document.getElementById('bulk-add').onclick = () => {
      const dc = document.getElementById('bulk-cat').value.trim();
      for (const line of document.getElementById('bulk').value.split('\n')) {
        const [name, patterns, category] = line.split('\t').map((x) => (x || '').trim());
        if (name && patterns) list.push({ name, patterns: patterns.replace(/\s*,\s*/g, '\n'), category: category || dc });
      }
      draw();
    };
    document.getElementById('g-save').onclick = async () => {
      try {
        await api(`/api/projects/${pid}/lobs`, { method: 'PUT', body: { groups: list } });
        toast('Groups saved — click “Refresh from GSC” to load the numbers');
        route();
      } catch (e) { toast(e.message, 6000); }
    };
  };
  draw();
}

// ---------- project dashboard ----------
async function renderProject(pid, runId) {
  const [{ project }, { runs }] = await Promise.all([api('/api/projects/' + pid), api(`/api/projects/${pid}/runs`)]);
  const done = runs.filter((r) => r.status === 'done');
  const head = `<div class="row spread"><div><h1>${esc(project.name)}</h1>
      <div class="muted small">${esc(project.gsc_property)}${project.ga4_name ? ' · GA4: ' + esc(project.ga4_name) : ''} · via ${esc(project.connection_email || '—')}</div></div>
      <div class="row">${done.length ? `<select id="run-pick" style="width:auto">${done.map((r) => `<option value="${r.id}">${date(r.created_at)} · score ${r.score}</option>`).join('')}</select>` : ''}
      <a class="btn" href="#/p/${pid}/urls">📈 URL performance</a><a class="btn" href="#/p/${pid}/lob">📊 LOB report</a>${isAdmin() ? `<a class="btn" href="#/p/${pid}/edit">Settings</a>` : accessPill(project.my_role)}${canRun(project) ? `<a class="btn primary" href="#/p/${pid}/run">▶ Run analysis</a>` : ''}</div></div>`;
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
  if (!run.gsc) return renderArchivedRun(project, run, runs, head);
  const s = run.summary, k = s.kpis, gsc = run.gsc, ga = run.ga;
  CMP.cur = periodLabel(run.start_date, run.end_date); CMP.prev = periodLabel(run.prev_start, run.prev_end);
  pages.sort((a, b) => (b.gsc?.c || 0) - (a.gsc?.c || 0) || (b.gsc?.i || 0) - (a.gsc?.i || 0));
  const kpi = (label, v, d) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${v}</div>${d || '<span class="delta muted">&nbsp;</span>'}</div>`;
  const tabs = ['Insights', 'GSC + GA', 'GSC', 'GA', 'Quick wins', 'Major optimisations', 'AI search & GEO', 'Rendering', 'Pages', 'Technical', 'History'];
  app.innerHTML = head + `
    <div class="muted small" style="margin-top:6px">Data ${run.start_date} → ${run.end_date} vs ${run.prev_start} → ${run.prev_end}${s.compare === 'year' ? ' (last year)' : s.compare === 'custom' ? ' (custom)' : ''} · ${s.pagesCrawled} pages crawled${s.moneyPages ? ` (💰 ${s.moneyPages} money)` : ''}${s.full ? ` · full export: ${fmt(s.full.queries)} queries` : ''}${s.scope ? ` · <b>scope: ${esc(s.scope)}</b>` : ''} · run by ${esc(run.created_by)}</div>
    <div class="card section"><div class="scores">
      <div class="score click-score" data-score="overall">${ring(s.scores.overall, true)}<div><b>Overall SEO score</b><div class="muted small">${s.scores.overall >= 80 ? 'Strong' : s.scores.overall >= 55 ? 'Needs work' : 'Poor'}</div></div></div>
      <div class="score click-score" data-score="onpage">${ring(s.scores.onpage)}<div><b>On-page</b><div class="muted small">Titles, meta, headings, links, schema</div></div></div>
      <div class="score click-score" data-score="content">${ring(s.scores.content)}<div><b>Content</b><div class="muted small">Query coverage & depth</div></div></div>
      <div class="score click-score" data-score="technical">${ring(s.scores.technical)}<div><b>Technical</b><div class="muted small">Indexability, sitemap, robots</div></div></div>
      ${s.geo ? `<div class="score click-score" data-tab="AI search & GEO">${ring(s.geo.score)}<div><b>AI search</b><div class="muted small">GEO readiness for AI Overviews, ChatGPT…</div></div></div>` : ''}
    </div></div>
    <div class="grid kpis section">
      ${kpi('Clicks', fmt(k.clicks), delta(k.clicks, k.prev?.clicks))}
      ${kpi('Impressions', fmt(k.impressions), delta(k.impressions, k.prev?.impressions))}
      ${kpi('CTR', pct(k.ctr, 2), delta(k.ctr, k.prev?.ctr, { isPct: true }))}
      ${kpi('Avg position', fmt(k.position, 1), delta(k.position, k.prev?.position, { invert: true }))}
      ${k.sessions != null ? kpi('Organic sessions', fmt(k.sessions), delta(k.sessions, k.prevSessions)) : ''}
      ${k.keyEvents != null ? kpi('Organic key events', fmt(k.keyEvents), delta(k.keyEvents, k.prevKeyEvents)) : ''}
      ${s.brand ? kpi('Non-branded clicks', fmt(s.brand.nonBranded.c), `<span class="small muted">${pct(s.brand.nonBranded.c / Math.max(1, s.brand.nonBranded.c + s.brand.branded.c))} of clicks</span>`) + kpi('Branded clicks', fmt(s.brand.branded.c), `<span class="small muted">${fmt(s.brand.branded.n)} queries</span>`) : ''}
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><span class="small muted" style="margin-right:auto">Tip: click any score or number for the breakdown.</span><button class="btn" id="xlsx-btn">⬇ Excel report</button></div>
    <div class="tabs">${tabs.map((t, i) => `<button class="tab ${i ? '' : 'active'}" data-t="${t}">${t}</button>`).join('')}</div>
    <div id="tab"></div>`;
  const views = {
    Insights: () => viewInsights(project, run, pages),
    'GSC + GA': () => viewGscGa(run, pages, project),
    GSC: () => viewGsc(run, pages),
    GA: () => viewGa(run),
    'Quick wins': () => viewQuick(s.opps, pages),
    'Major optimisations': () => viewMajor(run, pages),
    'AI search & GEO': () => viewGeo(run, pages),
    Rendering: () => viewRendering(run, pages),
    Pages: () => viewPages(pages, project, run),
    Technical: () => viewTechnical(s.site, pages),
    History: () => viewHistory(runs, project),
  };
  const show = (t) => {
    app.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
    document.getElementById('tab').innerHTML = views[t]();
    bindTab(project, run, pages);
  };
  app.querySelectorAll('.tab').forEach((b) => (b.onclick = () => show(b.dataset.t)));
  // score cards (and the cards inside the overall drawer) open their breakdown
  scoreCtx = { run, pages };
  tabShow = show;
  // KPI tiles jump to the matching tab
  app.querySelectorAll('.kpis .kpi').forEach((el) => { el.classList.add('click'); el.onclick = () => show(/session|key event/i.test(el.textContent) ? 'GA' : 'GSC'); });
  document.getElementById('xlsx-btn').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Building…';
    try { await exportExcel(project, run, pages); } catch (err) { toast(err.message); }
    e.target.disabled = false; e.target.textContent = '⬇ Excel report';
  };
  show('Insights');
}

// Older runs past the retention window keep only scores, KPIs and the AI report
function renderArchivedRun(project, run, runs, head) {
  const s = run.summary, k = s.kpis || {};
  CMP.cur = periodLabel(run.start_date, run.end_date); CMP.prev = periodLabel(run.prev_start, run.prev_end);
  const kpi = (label, v, d) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${v}</div>${d || ''}</div>`;
  app.innerHTML = head + `<div class="banner section">🗄️ <b>Archived run</b> (${run.start_date} → ${run.end_date}). Older runs keep their scores, KPIs and AI report; crawled pages and exports were removed to save space (see Settings → Data retention).</div>
    <div class="card section"><div class="scores">
      <div class="score">${ring(s.scores?.overall, true)}<div><b>Overall SEO score</b></div></div>
      <div class="score">${ring(s.scores?.onpage)}<div><b>On-page</b></div></div>
      <div class="score">${ring(s.scores?.content)}<div><b>Content</b></div></div>
      <div class="score">${ring(s.scores?.technical)}<div><b>Technical</b></div></div>
      ${s.geo ? `<div class="score">${ring(s.geo.score)}<div><b>AI search</b></div></div>` : ''}
    </div></div>
    <div class="grid kpis section">
      ${kpi('Clicks', fmt(k.clicks), delta(k.clicks, k.prev?.clicks))}${kpi('Impressions', fmt(k.impressions), delta(k.impressions, k.prev?.impressions))}
      ${kpi('CTR', pct(k.ctr, 2), delta(k.ctr, k.prev?.ctr, { isPct: true }))}${kpi('Avg position', fmt(k.position, 1), delta(k.position, k.prev?.position, { invert: true }))}
      ${k.sessions != null ? kpi('Organic sessions', fmt(k.sessions), delta(k.sessions, k.prevSessions)) : ''}
    </div>
    <div class="tabs"><button class="tab active" data-t="Insights">Insights</button><button class="tab" data-t="History">History</button></div><div id="tab"></div>`;
  const show = (t) => { app.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.t === t)); document.getElementById('tab').innerHTML = t === 'History' ? viewHistory(runs, project) : viewInsights(project, run, []); };
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
  insightCtx = { run, pages, project };
  const btn = (label, cls) => (canRun(project) ? `<button class="btn ${cls}" id="ai-retry">${label}</button>` : '');
  if (!ai) return `<div class="card center"><h2>No AI analysis yet</h2><p class="muted">Uses the free Gemini key in Settings, with Cloudflare AI as backup.</p>${btn('Generate AI analysis', 'primary')}</div>`;
  const has = (a) => Array.isArray(a) && a.length;
  const urls = (list) => (has(list) ? `<div class="small">${list.filter(Boolean).map((u) => (/^https?:|^\//.test(u) ? pageLink(u.startsWith('/') ? new URL(u, project.site_url).href : u, pages) : esc(u))).join(' · ')}</div>` : '');
  const chips = (list) => (has(list) ? `<div class="small muted">${list.map(esc).join(' · ')}</div>` : '');
  const block = (title, icon, color, items, render, sec) => (has(items) ? `<div class="card section rv" style="border-top:4px solid ${color}"><h2>${icon} ${title}</h2><ul class="bullets">${items.map((x, i) => render(x, sec, i)).join('')}</ul></div>` : '');
  const pt = (x, sec, i) => `<li class="bullet click" data-ins="${sec}:${i}"><b>${esc(x.point || x.title || '')}</b>${x.evidence ? `<div class="small muted">${esc(x.evidence)}</div>` : ''}<div class="small"><span class="link">${(x.pages || []).length ? `${x.pages.length} page${x.pages.length > 1 ? 's' : ''}` : 'pages'} · ${(x.queries || []).length ? `${x.queries.length} quer${x.queries.length > 1 ? 'ies' : 'y'}` : 'queries'} →</span></div></li>`;
  const ap = ai.action_plan || {};
  const owner = (o) => `<span class="pill ${o === 'dev' ? 'bad' : o === 'content' ? 'warn' : 'info'}">${esc(o || 'seo')}</span>`;
  const structured = has(ai.what_went_well) || has(ai.what_didnt_work) || ai.action_plan;
  return `<div class="card"><div class="row spread"><h2 style="margin:0">Summary</h2><span class="pill ${ai.health === 'good' ? 'good' : ai.health === 'poor' ? 'bad' : 'warn'}">${esc((ai.health || '').replace('_', ' '))}</span></div>
      <p>${esc(ai.summary)}</p>
      <div class="row spread small muted"><span>${run.start_date} → ${run.end_date} vs ${run.prev_start} → ${run.prev_end} · generated ${ai.generated_at ? date(ai.generated_at) : ''} by ${esc(ai.provider || 'Gemini')}</span>${btn('Regenerate', 'sm')}</div></div>
    ${structured ? '<p class="small muted section">Click any bullet to see the pages and queries behind it.</p>' : ''}${structured ? '' : '<div class="banner section">This analysis uses the old format — click <b>Regenerate</b> for the new "What went well / didn\'t work / Action plan" report.</div>'}
    <div class="grid g2">
      ${block('What went well', '✅', 'var(--good)', ai.what_went_well, pt, 'what_went_well')}
      ${block('How we achieved it', '🏗️', 'var(--primary)', ai.how_we_achieved_it, pt, 'how_we_achieved_it')}
      ${block("What didn't work", '⚠️', 'var(--bad)', ai.what_didnt_work, pt, 'what_didnt_work')}
      ${block('How we can improve', '📈', 'var(--warn)', ai.how_to_improve, pt, 'how_to_improve')}
    </div>
    ${Array.isArray(ai.action_plan) && ai.action_plan.length ? `<div class="card section"><h2>📋 Action plan</h2>${ai.action_plan.map((area, i) => `<h3 class="ap-h">${i + 1}. ${esc(area.area)}</h3>
      ${(area.items || []).map((t) => `<div class="check"><span class="pill ${t.priority === 'high' ? 'bad' : t.priority === 'medium' ? 'warn' : ''}" style="flex:none">${esc(t.priority || '')}</span><div style="flex:1"><b>${esc(t.task)}</b> ${owner(t.owner)}${t.evidence ? `<div class="small muted">📊 ${esc(t.evidence)}</div>` : ''}${urls(t.urls)}
        ${t.observation || t.failure_check ? `<details class="small" style="margin-top:4px"><summary class="muted">Why & how we'll know</summary>${t.observation ? `<div>👁️ <b>Observation:</b> ${esc(t.observation)}</div>` : ''}${t.depends_on && t.depends_on !== 'none' ? `<div>🔗 <b>Depends on:</b> ${esc(t.depends_on)}</div>` : ''}${t.leading_indicator ? `<div>📈 <b>Leading indicator:</b> ${esc(t.leading_indicator)}</div>` : ''}${t.failure_check ? `<div>🧪 <b>Failed if:</b> ${esc(t.failure_check)}</div>` : ''}</details>` : ''}</div></div>`).join('')}`).join('')}</div>` : ''}
    ${(ai.ai_search_geo || []).length ? `<div class="card section"><h2>🤖 AI search & GEO</h2>${ai.ai_search_geo.slice(0, 4).map((x) => `<div class="check"><div><b>${esc(x.issue)}</b> ${x.url ? urls([x.url]) : ''}<div class="small">➡️ ${esc(x.change)}</div></div></div>`).join('')}<p class="small"><a href="#" data-tab="AI search & GEO">See all in the AI search & GEO tab →</a></p></div>` : ''}
    ${ai.action_plan && !Array.isArray(ai.action_plan) ? `<div class="card section"><h2>📋 Action plan</h2>
      ${has(ap.onpage_schema) ? `<h3 class="ap-h">1. On-page changes + schema</h3><div class="table-wrap"><table><thead><tr><th>Page</th><th>Changes</th><th>Schema</th></tr></thead><tbody>${ap.onpage_schema.map((x) => `<tr><td>${urls([x.url])}</td><td><ul class="small" style="margin:0;padding-left:18px">${(x.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></td><td class="small">${esc(x.schema || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${has(ap.topical_authority) ? `<h3 class="ap-h">2. Topical authority — blogs to publish</h3>${ap.topical_authority.map((t) => `<div class="reco"><h3>${esc(t.topic)}</h3><p class="small">${esc(t.why || '')}${t.pillar_url ? ` · Pillar: <b>${esc(t.pillar_url)}</b>` : ''}</p>
        <ol class="small">${(t.blogs || []).map((b) => `<li><b>${esc(b.title)}</b> <span class="muted">/${esc(String(b.slug || '').replace(/^\//, ''))}</span> — targets “${esc(b.target_query)}”</li>`).join('')}</ol></div>`).join('')}` : ''}
      ${has(ap.technical) ? `<h3 class="ap-h">3. Technical (needs tech help)</h3>${ap.technical.map((t) => `<div class="check"><div style="flex:1"><b>${esc(t.issue)}</b> ${owner(t.owner)}<div class="small muted">${esc(t.evidence || '')}</div><div class="small">➡️ ${esc(t.fix)}</div></div></div>`).join('')}` : ''}
      ${has(ap.navigation_internal_links) ? `<h3 class="ap-h">4. Navigation, footer & internal links</h3>${ap.navigation_internal_links.map((t) => `<div class="check"><div><b>${esc(t.issue)}</b><div class="small">➡️ ${esc(t.fix)}</div></div></div>`).join('')}` : ''}
      ${has(ap.external_links) ? `<h3 class="ap-h">5. External links</h3>${ap.external_links.map((t) => `<div class="check"><div><b>${esc(t.issue)}</b><div class="small">➡️ ${esc(t.fix)}</div></div></div>`).join('')}` : ''}
    </div>` : ''}
    ${has(ai.cro) ? `<div class="card section"><h2>💸 CRO experiments</h2>${ai.cro.map((c) => `<div class="reco" style="border-left-color:var(--good)"><h3>${urls([c.url])}</h3><p class="small muted">${esc(c.evidence || '')}</p><p><b>Hypothesis:</b> ${esc(c.hypothesis)}</p><p><b>Change:</b> ${esc(c.change)}</p><p class="small"><b>Measure:</b> ${esc(c.metric || '')}</p></div>`).join('')}</div>` : ''}
    ${has(ai.quick_wins) ? `<div class="card section"><h2>⚡ Quick wins</h2>${ai.quick_wins.map((q) => `<div class="check"><div><b>${esc(q.query)}</b> <span class="pill">pos ${esc(q.position)}</span>${q.impressions ? ` <span class="pill">${fmt(q.impressions)} impr</span>` : ''}<div class="small">${esc(q.action)}</div>${q.url ? urls([q.url]) : ''}</div></div>`).join('')}</div>` : ''}
    ${has(ai.priorities) ? `<div class="card section"><h2>Priority actions</h2>${ai.priorities.map((p) => `<div class="reco"><h3>${esc(p.title)}</h3><p><b>Why:</b> ${esc(p.why)}</p><p><b>How:</b> ${esc(p.how)}</p>${urls(p.urls)}</div>`).join('')}</div>` : ''}
    ${has(ai.content_clusters) ? `<div class="card section"><h2>🧭 Content clusters</h2>${ai.content_clusters.map((c) => `<div class="reco"><h3>${esc(c.cluster)}</h3><p class="small">Pillar: ${esc(c.pillar)}</p><ul class="small">${(c.supporting_pages || []).map((sp) => `<li>${esc(sp.url)} (${esc(sp.status)}) — ${esc((sp.target_queries || []).join(', '))}</li>`).join('')}</ul></div>`).join('')}</div>` : ''}
    ${has(ai.page_recommendations) ? `<div class="card section"><h2>Page recommendations</h2>${ai.page_recommendations.map((p) => `<div class="reco"><h3>${urls([p.url])}</h3><p>${esc(p.problem)}</p>${p.title_suggestion ? `<p class="small"><b>Title:</b> ${esc(p.title_suggestion)}</p>` : ''}</div>`).join('')}</div>` : ''}`;
}

// ---------- comparison helpers (current vs comparison period) ----------
function aggQueries(pq) {
  const a = {};
  for (const r of pq) { const t = (a[r.q] ||= { q: r.q, c: 0, i: 0, pw: 0 }); t.c += r.c; t.i += r.i; t.pw += r.p * r.i; }
  return Object.values(a).map((t) => ({ q: t.q, c: t.c, i: t.i, ctr: t.i ? t.c / t.i : 0, p: t.i ? +(t.pw / t.i).toFixed(1) : 0 }));
}
function computeMovers(curQ, prevQ, curP, prevP, crawled, isBranded) {
  const pick = (cur, prev, key) => {
    const pm = Object.fromEntries(prev.map((r) => [r[key], r]));
    const seen = new Set();
    const rows = cur.map((r) => { seen.add(r[key]); const o = pm[r[key]]; return { k: r[key], c: r.c, pc: o?.c || 0, i: r.i, pi: o?.i || 0, p: r.p, pp: o?.p ?? null }; });
    for (const o of prev) if (!seen.has(o[key])) rows.push({ k: o[key], c: 0, pc: o.c, i: 0, pi: o.i, p: null, pp: o.p });
    rows.forEach((r) => (r.d = r.c - r.pc));
    return rows;
  };
  const q = pick(curQ, prevQ, 'q').map((r) => ({ ...r, b: isBranded(r.k) }));
  const byUrl = Object.fromEntries(crawled.map((p) => [p.url, p]));
  const p = pick(curP, prevP, 'u').map((r) => ({ ...r, onpage: byUrl[r.k]?.onpage_score ?? null, content: byUrl[r.k]?.content_score ?? null }));
  const top = (list, dir) => [...list].sort((a, b) => dir * (b.d - a.d)).filter((r) => dir * r.d > 0).slice(0, 25);
  const stat = (list) => ({ up: list.filter((r) => r.d > 0).length, down: list.filter((r) => r.d < 0).length, gained: list.filter((r) => r.d > 0).reduce((s, r) => s + r.d, 0), lost: list.filter((r) => r.d < 0).reduce((s, r) => s + r.d, 0) });
  const avg = (list, k) => { const v = list.map((r) => r[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
  const pu = top(p, 1), pd = top(p, -1);
  return {
    queriesUp: top(q, 1), queriesDown: top(q, -1), pagesUp: pu, pagesDown: pd,
    queryStats: stat(q), pageStats: stat(p), nonBrandedStats: stat(q.filter((r) => !r.b)),
    winnersAvgOnpage: avg(pu, 'onpage'), losersAvgOnpage: avg(pd, 'onpage'),
    losersWithPosDrop: pd.filter((r) => r.pp != null && r.p != null && r.p - r.pp >= 1).length,
  };
}
function navGaps(pages, siteUrl, terms) {
  const home = pages.find((p) => p.url === siteUrl && p.meta) || pages.find((p) => p.meta?.navLinks?.length);
  if (!home?.meta) return null;
  const norm = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const navText = norm((home.meta.navLinks || []).join(' | '));
  const footText = norm((home.meta.footerLinks || []).join(' | '));
  const stop = new Set('a an and the for of in on to with best vs near me online'.split(' '));
  const has = (text, term) => norm(term).split(' ').filter((w) => w && !stop.has(w)).every((w) => text.includes(w.replace(/s$/, '')));
  const rows = terms.map((t) => ({ ...t, inNav: has(navText, t.term), inFooter: has(footText, t.term) }));
  return { page: home.url, navCount: home.meta.navLinks?.length || 0, footerCount: home.meta.footerLinks?.length || 0, missing: rows.filter((r) => !r.inNav && !r.inFooter), rows };
}
const scopeOf = (s) => (s?.scopeGroups?.length ? lobMatcher(s.scopeGroups) : null);
function moversFor(run, pages) {
  const s = run.summary;
  if (s.movers) return s.movers;
  const g = run.gsc;
  return computeMovers(g.queries, g.prevQueries, g.pages, g.prevPages, pages, brandTester(s.brand?.terms));
}
// short labels like "Sep" / "Aug" (or date spans) used in every comparison cell
const CMP = { cur: '', prev: '' };
function periodLabel(a, b) {
  const s = new Date(a + 'T00:00:00Z'), e = new Date(b + 'T00:00:00Z');
  const mo = (d) => d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  const lastDay = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
  if (s.getUTCDate() === 1 && s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) return mo(s) + (e.getUTCDate() === lastDay ? '' : ' (MTD)') + " '" + String(s.getUTCFullYear()).slice(2);
  const f = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f(s)}–${f(e)}`;
}
const dcell = (v, pv, f = fmt, opt) => `<span class="nowrap">${v == null ? '–' : f(v)}</span>${pv == null ? '' : `<div class="small nowrap"><span class="muted">${esc(CMP.prev)}: ${f(pv)}</span> ${delta(v, pv, opt)}</div>`}`;

// ---------- score breakdowns & technical action items ----------
let scoreCtx = null;
let tabShow = null;
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tab]');
  if (!el || !tabShow) return;
  e.preventDefault();
  tabShow(el.dataset.tab);
  document.querySelector('.tabs')?.scrollIntoView({ behavior: 'smooth' });
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-score]');
  if (el && scoreCtx) scoreDetail(el.dataset.score, scoreCtx.run, scoreCtx.pages);
});
const CHECK_META = {
  status: ['dev', 'Return HTTP 200 (or 301 to the right page) and remove broken URLs from sitemap & internal links'],
  redirect: ['dev', 'Link straight to the final URL; update internal links and sitemap to skip the redirect'],
  index: ['dev', 'Remove noindex (meta robots / X-Robots-Tag) if the page should rank'],
  https: ['dev', 'Serve over HTTPS and 301 all HTTP URLs to HTTPS'],
  canonical: ['dev', 'Add <link rel="canonical"> pointing to the preferred URL'],
  'canon-self': ['seo', 'Check the canonical target — self-reference unless consolidating on purpose'],
  viewport: ['dev', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">'],
  lang: ['dev', 'Add a lang attribute to <html> (e.g. lang="en-IN")'],
  speed: ['dev', 'Cut server response time below 1.5 s (caching, CDN, backend)'],
  size: ['dev', 'Reduce HTML size: move inline scripts/styles out, trim markup'],
  js: ['dev', 'Server-side render or pre-render the main content so bots see it without JavaScript'],
  title: ['seo', 'Write a unique 30–60 character title starting with the main non-branded keyword'],
  'title-len': ['seo', 'Rewrite the title to 30–60 characters, keyword first'],
  desc: ['seo', 'Write a 140–155 character meta description: keyword + benefit + CTA'],
  'desc-len': ['seo', 'Rewrite the meta description to 140–155 characters'],
  og: ['seo', 'Add og:title and og:image for social sharing'],
  h1: ['seo', 'Use exactly one H1 containing the main non-branded keyword'],
  h2: ['content', 'Add H2 subheadings for the sub-topics people search for'],
  schema: ['seo', 'Add relevant JSON-LD (Product / FAQPage / Article / BreadcrumbList)'],
  internal: ['seo', 'Add at least 5 contextual internal links to related pages'],
  alt: ['content', 'Add descriptive alt text to images'],
  words: ['content', 'Expand the copy to cover the page’s queries (aim for 600+ useful words)'],
  'topq-title': ['seo', 'Add the top non-branded query to the title'],
  'topq-h1': ['seo', 'Add the top non-branded query to the H1'],
};
function checkActions(pages, cats) {
  const ok = pages.filter((p) => p.checks?.length);
  const totalImp = ok.reduce((s, p) => s + (p.gsc?.i || 0), 0) || 1;
  const by = {};
  for (const p of ok) for (const c of p.checks) {
    if (cats && !cats.includes(c.cat)) continue;
    const id = c.id.startsWith('topq') ? c.id : c.id;
    const t = (by[id] ||= { id, label: c.label.replace(/: “.*”$/, ''), cat: c.cat, weight: c.weight, fail: [], checked: 0 });
    t.checked++;
    if (c.val < 1) t.fail.push(p);
  }
  return Object.values(by).filter((t) => t.fail.length).map((t) => {
    const imp = t.fail.reduce((s, p) => s + (p.gsc?.i || 0), 0);
    const share = imp / totalImp, rate = t.fail.length / t.checked;
    const money = t.fail.filter((p) => p.money).length;
    const score = t.weight * (share * 2 + rate) + (money ? 2 : 0);
    const impact = score >= 6 || (t.weight >= 5 && share >= 0.2) ? 'High' : score >= 2.5 ? 'Medium' : 'Low';
    const [owner, fix] = CHECK_META[t.id] || ['seo', ''];
    return { ...t, imp, share, rate, money, impact, owner, fix, score, examples: [...t.fail].sort((a, b) => (b.gsc?.i || 0) - (a.gsc?.i || 0)).slice(0, 5) };
  }).sort((a, b) => b.score - a.score);
}
const impactPill2 = (v) => `<span class="pill ${v === 'High' ? 'bad' : v === 'Medium' ? 'warn' : 'info'}">${v}</span>`;
function actionsTable(list, pages) {
  return table([
    { key: 'impact', label: 'Impact', render: (t) => impactPill2(t.impact), sort: (t) => t.score },
    { key: 'label', label: 'Issue', render: (t) => `<b>${esc(t.label)}</b><div class="small muted">${esc(t.fix)}</div>` },
    { key: 'owner', label: 'Owner', render: (t) => `<span class="pill">${t.owner}</span>` },
    { key: 'n', label: 'Pages', num: 1, render: (t) => `${fmt(t.fail.length)}<div class="small muted">of ${fmt(t.checked)}${t.money ? ` · 💰${t.money}` : ''}</div>`, sort: (t) => t.fail.length },
    { key: 'imp', label: 'Impr. affected', num: 1, render: (t) => `${fmt(t.imp)}<div class="small muted">${pct(t.share)}</div>` },
    { key: 'ex', label: 'Example pages', render: (t) => t.examples.slice(0, 3).map((p) => pageLink(p.url, pages)).join('<br>') },
  ], list, { filter: false, limit: 100 });
}
function scoreDetail(kind, run, pages) {
  const s = run.summary;
  const head = (t, v, sub) => `<div class="row" style="gap:16px">${ring(v, true)}<div><h2 style="margin:0">${t}</h2><div class="muted small">${sub}</div></div></div>`;
  if (kind === 'overall') {
    return openDrawer(`${head('Overall SEO score', s.scores.overall, 'Weighted: 40% on-page + 40% content + 20% technical. Pages count more when they get more impressions.')}
      <div class="grid kpis section">${[['onpage', 'On-page', s.scores.onpage], ['content', 'Content', s.scores.content], ['technical', 'Technical', s.scores.technical]].map(([k, l, v]) => `<div class="card kpi click" data-score="${k}"><div class="label">${l}</div><div class="value">${v}</div><span class="small muted">open breakdown →</span></div>`).join('')}</div>
      <div class="card section"><h3>Biggest fixes across the site</h3>${actionsTable(checkActions(pages).slice(0, 10), pages)}</div>`);
  }
  if (kind === 'onpage') {
    return openDrawer(`${head('On-page score', s.scores.onpage, 'Titles, meta descriptions, headings, schema, internal links, images, content length — per page, weighted by impressions.')}
      <div class="card section"><h3>Issues by impact</h3>${actionsTable(checkActions(pages, ['Meta', 'Structure', 'Content']), pages)}</div>
      <div class="card section"><h3>Lowest on-page pages (by impressions)</h3>${table([{ key: 'url', label: 'Page', render: (p) => pageLink(p.url, pages) }, { key: 'onpage_score', label: 'Score', num: 1, render: (p) => `<span class="pill ${pillFor(p.onpage_score)}">${p.onpage_score}</span>` }, { key: 'i', label: 'Impr.', num: 1, render: (p) => fmt(p.gsc?.i), sort: (p) => p.gsc?.i || 0 }], pages.filter((p) => p.meta && p.onpage_score < 80).sort((a, b) => (b.gsc?.i || 0) - (a.gsc?.i || 0)).slice(0, 30), { filter: false })}</div>`);
  }
  if (kind === 'content') {
    const rows = pages.filter((p) => p.meta).map((p) => ({ p, gaps: (p.queries || []).filter((q) => q.score < 60).slice(0, 3) })).filter((x) => x.gaps.length).sort((a, b) => (b.p.gsc?.i || 0) - (a.p.gsc?.i || 0)).slice(0, 40);
    return openDrawer(`${head('Content score', s.scores.content, 'How well each page targets the non-branded queries it ranks for (title, H1, headings, meta, intro, body) plus content depth.')}
      <div class="card section"><h3>Pages missing their non-branded keywords</h3>${table([
        { key: 'url', label: 'Page', render: (x) => pageLink(x.p.url, pages) },
        { key: 'score', label: 'Content', num: 1, render: (x) => `<span class="pill ${pillFor(x.p.content_score)}">${x.p.content_score}</span>`, sort: (x) => x.p.content_score },
        { key: 'gaps', label: 'Keyword → missing from', render: (x) => x.gaps.map((q) => `<div class="small"><b>${esc(q.query)}</b> <span class="muted">(${fmt(q.impressions)} impr)</span> → ${esc(missingSpots(q).join(', ') || 'weak coverage')}</div>`).join('') },
      ], rows, { filter: false })}</div>`);
  }
  // technical
  const modes = s.renderModes || {};
  return openDrawer(`${head('Technical score', s.scores.technical, 'Site checks (robots.txt, sitemap, duplicates, status codes, indexability) plus page-level technical checks.')}
    <div class="card section"><h3>Site checks</h3>${s.site.checks.map((c) => `<div class="check"><span class="dot ${c.val >= 1 ? 'good' : c.val > 0 ? 'warn' : 'bad'}">${c.val >= 1 ? '✓' : c.val > 0 ? '!' : '✗'}</span><div><div>${esc(c.label)}</div><div class="small muted">${esc(c.detail)}</div></div></div>`).join('')}</div>
    ${Object.keys(modes).length ? `<div class="card section"><h3>Rendering</h3><p>${Object.entries(modes).map(([k, v]) => `<span class="pill ${k === 'CSR' ? 'bad' : 'good'}">${esc(k)}: ${v}</span>`).join(' ')}</p></div>` : ''}
    <div class="card section"><h3>Technical action items</h3>${actionsTable(checkActions(pages, ['Technical']), pages)}</div>`);
}

// ---------- Excel export ----------
function loadXlsx() {
  if (window.XLSX?.utils && window.XLSX.__styled) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/xlsx.bundle.js';
    sc.onload = () => { window.XLSX.__styled = true; res(window.XLSX); };
    sc.onerror = () => rej(new Error('Could not load the Excel library'));
    document.head.appendChild(sc);
  });
}
async function exportExcel(project, run, pages) {
  const X = await loadXlsx();
  const s = run.summary, k = s.kpis;
  const isB = brandTester(s.brand?.terms || project.brand_terms);
  const wb = X.utils.book_new();
  const border = { top: { style: 'thin', color: { rgb: 'E3E6EE' } }, bottom: { style: 'thin', color: { rgb: 'E3E6EE' } }, left: { style: 'thin', color: { rgb: 'E3E6EE' } }, right: { style: 'thin', color: { rgb: 'E3E6EE' } } };
  const HEAD = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '4F46E5' } }, alignment: { vertical: 'center', wrapText: true }, border };
  const FILL = { High: 'FDE2E1', Medium: 'FEF3C7', Low: 'E0E7FF' };
  const sheet = (name, header, rows, widths, opts = {}) => {
    const ws = X.utils.aoa_to_sheet([header, ...rows]);
    const range = X.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) for (let C = range.s.c; C <= range.e.c; C++) {
      const a = X.utils.encode_cell({ r: R, c: C });
      if (!ws[a]) ws[a] = { t: 's', v: '' };
      if (R === 0) { ws[a].s = HEAD; continue; }
      const st = { alignment: { vertical: 'top', wrapText: true }, border };
      const v = ws[a].v;
      if (opts.priorityCol === C && FILL[v]) st.fill = { fgColor: { rgb: FILL[v] } }, (st.font = { bold: true });
      if (typeof v === 'number') { st.numFmt = opts.pctCols?.includes(C) ? '0.0%' : Number.isInteger(v) ? '#,##0' : '#,##0.0'; st.alignment = { vertical: 'top', horizontal: 'right' }; }
      if (R % 2 === 0) st.fill ||= { fgColor: { rgb: 'F7F8FC' } };
      ws[a].s = st;
    }
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    ws['!rows'] = [{ hpt: 28 }];
    ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r, c: range.e.c } }) };
    X.utils.book_append_sheet(wb, ws, name);
  };
  const cur = CMP.cur, prev = CMP.prev;
  const kp = (l, a, b, pctFmt) => [l, a ?? '', b ?? '', a != null && b ? (a - b) / b : ''];
  sheet('Summary', ['Metric', cur, prev, 'Change %'], [
    ['Project', project.name, '', ''], ['Period', `${run.start_date} → ${run.end_date}`, `${run.prev_start} → ${run.prev_end}`, ''],
    ['Scope', s.scope || 'Whole site', '', ''], ['Overall SEO score', s.scores.overall, '', ''], ['On-page score', s.scores.onpage, '', ''], ['Content score', s.scores.content, '', ''], ['Technical score', s.scores.technical, '', ''],
    kp('Clicks', k.clicks, k.prev?.clicks), kp('Impressions', k.impressions, k.prev?.impressions), kp('CTR', k.ctr, k.prev?.ctr), kp('Avg position', k.position, k.prev?.position),
    kp('Organic sessions (GA4)', k.sessions, k.prevSessions), kp('Organic key events (GA4)', k.keyEvents, k.prevKeyEvents),
    ...(s.brand ? [kp('Non-branded clicks', s.brand.nonBranded.c, s.prevBrand?.nonBranded.c), kp('Branded clicks', s.brand.branded.c, s.prevBrand?.branded.c)] : []),
  ], [32, 26, 26, 12], { pctCols: [3] });

  // keyword placement — non-branded only
  const kw = [];
  for (const p of pages) for (const q of p.queries || []) {
    if (isB(q.query) || q.score >= 80 || q.impressions < 10) continue;
    const miss = missingSpots(q);
    const actions = [];
    if (q.inTitle < 1) actions.push('Add to title');
    if (q.inMeta < 1) actions.push('Add to meta description');
    if (q.inH1 < 1) actions.push('Add to H1');
    if (q.inH2 < 0.6) actions.push('Add an H2 for it');
    if (!q.bodyCount) actions.push('Write a 100–150 word section using the exact phrase');
    else if (q.inFirst100 < 0.6) actions.push('Mention it in the first 100 words');
    const pr = q.position >= 4 && q.position <= 20 && q.impressions >= 500 ? 'High' : q.impressions >= 200 ? 'Medium' : 'Low';
    kw.push([pr, p.url, q.query, q.impressions, q.clicks, +(+q.position).toFixed(1), q.inTitle >= 1 ? 'Yes' : 'No', q.inMeta >= 1 ? 'Yes' : 'No', q.inH1 >= 1 ? 'Yes' : 'No', q.inH2 >= 0.6 ? 'Yes' : 'No', q.bodyCount, q.score, actions.join('; '), p.money ? 'Yes' : '']);
  }
  kw.sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a[0]] - { High: 0, Medium: 1, Low: 2 }[b[0]]) || b[3] - a[3]);
  sheet('Keyword placement (non-brand)', ['Priority', 'URL', 'Non-branded keyword', 'Impressions', 'Clicks', 'Position', 'In title', 'In meta', 'In H1', 'In H2', 'Times in copy', 'Coverage score', 'Action', 'Money page'], kw, [10, 50, 34, 12, 10, 9, 8, 8, 8, 8, 10, 10, 60, 10], { priorityCol: 0 });

  const acts = checkActions(pages);
  sheet('Technical action items', ['Impact', 'Issue', 'Category', 'Owner', 'Fix', 'Pages affected', 'Pages checked', 'Impressions affected', 'Share of impressions', 'Money pages affected', 'Example URLs'],
    acts.map((t) => [t.impact, t.label, t.cat, t.owner, t.fix, t.fail.length, t.checked, t.imp, t.share, t.money, t.examples.map((p) => p.url).join('\n')]),
    [10, 34, 12, 9, 50, 10, 10, 14, 12, 12, 60], { priorityCol: 0, pctCols: [8] });
  const siteRows = (s.site?.checks || []).filter((c) => c.val < 1).map((c) => [c.weight >= 4 ? 'High' : 'Medium', c.label, 'Site', 'dev', c.detail]);
  if (siteRows.length) {
    const ws = wb.Sheets['Technical action items'];
    X.utils.sheet_add_aoa(ws, siteRows, { origin: -1 });
  }
  sheet('Page audit', ['URL', 'Money page', 'On-page', 'Content', 'Rendering', 'Framework', 'Words', 'Title', 'Title length', 'Meta length', 'H1', 'Schema', 'Internal links', 'External links', 'Clicks', 'Impressions', 'Position', 'Failed checks'],
    pages.filter((p) => p.meta).map((p) => [p.url, p.money ? 'Yes' : '', p.onpage_score, p.content_score, p.meta.renderMode || '', p.meta.framework || '', p.meta.wordCount, p.meta.title, (p.meta.title || '').length, (p.meta.description || '').length, (p.meta.h1s || []).join(' | '), (p.meta.schemaTypes || []).join(', '), p.meta.internalLinks, p.meta.externalLinks, p.gsc?.c ?? '', p.gsc?.i ?? '', p.gsc?.p ?? '', p.checks.filter((c) => c.val < 1).map((c) => c.label).join('; ')]),
    [50, 8, 8, 8, 14, 10, 8, 40, 8, 8, 34, 24, 9, 9, 10, 12, 8, 60]);
  sheet('Quick wins (non-brand)', ['Query', 'Ranking page', 'Position', 'Impressions', 'Clicks', 'CTR', 'Type'],
    [...s.opps.quickWins.filter((q) => !isB(q.q)).map((q) => [q.q, q.page || '', q.p, q.i, q.c, q.ctr, 'Striking distance (pos 4–15)']),
     ...s.opps.lowCtr.filter((q) => !isB(q.q)).map((q) => [q.q, q.page || '', q.p, q.i, q.c, q.ctr, `Low CTR (expected ${Math.round(q.expected * 100)}%)`])],
    [34, 50, 9, 12, 10, 8, 26], { pctCols: [5] });
  if (s.links?.suggestions?.length) sheet('Internal links', ['Add link on page', 'Anchor text', 'Link to', 'Target impressions', 'Target position', 'Target is money page'],
    s.links.suggestions.map((l) => [l.from, l.anchor, l.to, l.impressions, +(+l.position).toFixed(1), l.toMoney ? 'Yes' : '']), [50, 30, 50, 14, 12, 12]);
  if (s.geo) {
    sheet('AI search readiness', ['URL', 'Money page', 'AI score', 'Impressions', 'Question headings', 'Answer blocks', 'Lists+tables', 'Author', 'Last updated', 'Data points', 'Rendering', 'Failing checks'],
      pages.filter((p) => p.geo).sort((a, b) => a.geo.score - b.geo.score).map((p) => [p.url, p.money ? 'Yes' : '', p.geo.score, p.gsc?.i ?? '', p.meta.questionHeadings, p.meta.answerBlocks, (p.meta.lists || 0) + (p.meta.tables || 0), p.meta.hasAuthor ? 'Yes' : 'No', p.meta.lastDate || '', p.meta.stats, p.meta.renderMode || '', p.geo.checks.filter((c) => c.val < 1).map((c) => c.label).join('; ')]),
      [50, 8, 9, 12, 10, 10, 10, 8, 12, 10, 14, 70]);
    sheet('AI crawler access', ['Crawler', 'What it is for', 'Status', 'Rule'], s.geo.crawlers.map((c) => [c.bot, c.use, c.status, c.rule]), [20, 70, 14, 12]);
  }
  const m = moversFor(run, pages);
  const mv = (r, dir, type) => [type, dir, r.k, r.c, r.pc, r.c - r.pc, r.pc ? (r.c - r.pc) / r.pc : '', r.p ?? '', r.pp ?? ''];
  sheet('Gainers & losers', ['Type', 'Direction', 'Query / page', `Clicks ${cur}`, `Clicks ${prev}`, 'Change', 'Change %', `Pos ${cur}`, `Pos ${prev}`],
    [...m.queriesUp.map((r) => mv(r, 'Up', 'Query')), ...m.queriesDown.map((r) => mv(r, 'Down', 'Query')), ...m.pagesUp.map((r) => mv(r, 'Up', 'Page')), ...m.pagesDown.map((r) => mv(r, 'Down', 'Page'))],
    [8, 9, 50, 12, 12, 10, 10, 9, 9], { pctCols: [6] });
  X.writeFile(wb, `${project.name.replace(/[^\w.-]+/g, '-')}-SEO-${run.start_date}-to-${run.end_date}.xlsx`);
}

// ---------- AI search & GEO readiness ----------
function viewGeo(run, pages) {
  const g = run.summary.geo;
  if (!g) { setTimeout(() => loadAiVisibility(run.project_id, run, pages)); return '<div class="card center"><h2>Run a new analysis</h2><p class="muted">AI-search readiness is checked during the crawl — older runs don’t have it.</p></div><div id="aivis"></div>'; }
  const ok = pages.filter((p) => p.geo);
  const byCheck = {};
  for (const p of ok) for (const c of p.geo.checks) {
    const t = (byCheck[c.id] ||= { label: c.label, weight: c.weight, pass: 0, part: 0, n: 0, fail: [] });
    t.n++; if (c.val >= 1) t.pass++; else { if (c.val > 0) t.part++; t.fail.push(p); }
  }
  const checks = Object.values(byCheck).sort((a, b) => a.pass / a.n - b.pass / b.n || b.weight - a.weight);
  const ai = run.ai?.ai_search_geo || [];
  const st = (s) => `<span class="pill ${s === 'Allowed' ? 'good' : s === 'Blocked' ? 'bad' : 'warn'}">${s}</span>`;
  const tick = (v) => mark(v ? 1 : 0);
  setTimeout(() => {
    loadAiVisibility(run.project_id, run, pages);
    const sigs = trustSignals(pages);
    document.querySelectorAll('[data-trust]').forEach((el) => (el.onclick = () => {
      const t = sigs.find((x) => x.id === el.dataset.trust);
      openDrawer(`<h2>${esc(t.label)}</h2><p><b>${t.have}/${t.n}</b> crawled pages have it · <b>${t.missing.length}</b> missing</p>
        <div class="banner">🛠️ <b>Fix:</b> ${esc(t.fix)}</div>
        <div class="card section"><h3>Pages missing it (money pages & most impressions first)</h3>${table([
          { key: 'url', label: 'Page', render: (p) => `${p.money ? '💰 ' : ''}${pageLink(p.url, pages)}` },
          { key: 'i', label: 'Impr.', num: 1, render: (p) => fmt(p.gsc?.i), sort: (p) => p.gsc?.i || 0 },
          { key: 'r', label: 'Rendering', render: (p) => esc(p.meta.renderMode || '') },
        ], t.missing, { filter: false, limit: 500 })}${t.missing.some((p) => p.meta.renderMode === 'CSR') ? '<p class="hint">Some of these are client-rendered — the link/schema may exist after JavaScript runs but bots reading raw HTML won’t see it.</p>' : ''}</div>`);
    }));
  });
  return `<div class="card"><div class="scores">
      <div class="score">${ring(g.score, true)}<div><b>AI search readiness</b><div class="muted small">How easily AI Overviews, AI Mode, ChatGPT, Perplexity & Copilot can read, trust and quote your pages</div></div></div>
      <div class="score">${ring(g.pageScore)}<div><b>Page content</b><div class="muted small">Answer-ready structure, freshness, authorship, facts</div></div></div>
      <div class="score">${ring(g.siteScore)}<div><b>Site access & trust</b><div class="muted small">AI crawler access + trust pages & organisation schema</div></div></div>
    </div></div>
    ${ai.length ? `<div class="card section"><h2>🤖 AI recommendations for AI search</h2>${ai.map((x) => `<div class="reco"><h3>${x.url ? pageLink(x.url, pages) : esc(x.area || '')}</h3><p><b>${esc(x.issue || '')}</b></p><p>➡️ ${esc(x.change || '')}</p>${x.evidence ? `<p class="small muted">📊 ${esc(x.evidence)}</p>` : ''}${x.failure_check ? `<p class="small">🧪 <b>How we'd know it failed:</b> ${esc(x.failure_check)}</p>` : ''}</div>`).join('')}</div>` : ''}
    <div class="grid g2 section">
      <div class="card"><h2>AI crawler access (robots.txt)</h2>${table([
        { key: 'bot', label: 'Crawler', render: (c) => `<b>${esc(c.bot)}</b><div class="small muted">${esc(c.use)}</div>` },
        { key: 'status', label: 'Status', render: (c) => st(c.status) },
        { key: 'rule', label: 'Rule', render: (c) => `<span class="small muted">${esc(c.rule)}</span>` },
      ], g.crawlers, { filter: false })}<p class="hint">Blocking Googlebot removes you from Search <i>and</i> AI Overviews. Blocking Google-Extended only opts out of Gemini training. llms.txt: <b>${g.llms}</b> — Google Search ignores llms.txt; some other AI tools read it.</p></div>
      <div class="card"><h2>Trust signals (E-E-A-T)</h2>
        <p class="small muted">Checked on every crawled page. Click a signal to see which pages are missing it.</p>
        ${trustSignals(pages).map((t) => `<div class="check click" data-trust="${t.id}"><span class="pill ${pillFor((t.have / Math.max(1, t.n)) * 100)}" style="flex:none">${t.have}/${t.n}</span><div style="flex:1"><div>${esc(t.label)}</div><div class="small muted">${t.missing.length ? `missing on ${t.missing.length} page${t.missing.length > 1 ? 's' : ''} →` : 'all pages ✓'}</div></div></div>`).join('')}
        <p class="hint">Google weighs <b>Trust</b> highest in E-E-A-T. FAQ rich results were retired in May 2026 — keep FAQ sections for readers and AI answers, not for rich snippets.</p></div>
    </div>
    <div class="card section"><h2>Readiness checklist across crawled pages</h2>${table([
      { key: 'label', label: 'Check', render: (t) => `<b>${esc(t.label)}</b>` },
      { key: 'rate', label: 'Pages passing', num: 1, render: (t) => `<span class="pill ${pillFor((t.pass / t.n) * 100)}">${fmt((t.pass / t.n) * 100)}%</span> <span class="small muted">${t.pass}/${t.n} full${t.part ? ` · ${t.part} partial` : ''}</span>`, sort: (t) => (t.pass + t.part / 2) / t.n },
      { key: 'ex', label: 'Top failing pages', render: (t) => t.fail.sort((a, b) => (b.gsc?.i || 0) - (a.gsc?.i || 0)).slice(0, 3).map((p) => pageLink(p.url, pages)).join('<br>') },
    ], checks, { filter: false })}</div>
    <div class="card section"><h2>Pages</h2>${table([
      { key: 'url', label: 'Page', render: (p) => `${p.money ? '💰 ' : ''}<span class="url" style="display:inline-block">${esc(shortUrl(p.url))}</span>`, text: (p) => p.url },
      { key: 'g', label: 'AI score', num: 1, render: (p) => `<span class="pill ${pillFor(p.geo.score)}">${p.geo.score}</span>`, sort: (p) => p.geo.score },
      { key: 'i', label: 'Impr.', num: 1, render: (p) => fmt(p.gsc?.i), sort: (p) => p.gsc?.i || 0 },
      { key: 'q', label: 'Q-headings', num: 1, render: (p) => fmt(p.meta.questionHeadings) },
      { key: 'a', label: 'Answer blocks', num: 1, render: (p) => fmt(p.meta.answerBlocks) },
      { key: 'au', label: 'Author', render: (p) => tick(p.meta.hasAuthor) },
      { key: 'd', label: 'Updated', render: (p) => esc(p.meta.lastDate || '–') },
      { key: 'r', label: 'Rendering', render: (p) => esc(p.meta.renderMode || '') },
    ], ok, { limit: 1000, onRow: (p) => pageDetail(p, run) })}</div>
    <div id="aivis"><div class="card section muted">Loading AI answer visibility…</div></div>`;
}
// ---------- category filters (type · topic · top N) + "by category" summary ----------
const catState = {};
function catView(key, rows, urlOf, sums, renderTable) {
  const st = (catState[key] ||= { type: '', topic: '', top: '' });
  for (const r of rows) r.__cat ||= catOf(urlOf(r));
  const main = sums[0];
  const inFilter = (r) => (!st.type || r.__cat.type === st.type) && (!st.topic || r.__cat.topic === st.topic);
  const filtered = () => {
    const f = rows.filter(inFilter).sort((a, b) => (main.cur(b) || 0) - (main.cur(a) || 0));
    return st.top ? f.slice(0, +st.top) : f;
  };
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(([v, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)} (${n})</option>`).join('');
  const countBy = (fn, list) => { const m = {}; for (const r of list) { const k = fn(r); (m[k] ||= { n: 0, v: 0 }); m[k].n++; m[k].v += main.cur(r) || 0; } return Object.entries(m).sort((a, b) => b[1].v - a[1].v).map(([k, x]) => [k, x.n]); };
  const summary = () => {
    const g = {};
    for (const r of rows.filter(inFilter)) {
      const k = r.__cat.label;
      const t = (g[k] ||= { label: k, type: r.__cat.type, topic: r.__cat.topic, n: 0, v: sums.map(() => [0, 0]) });
      t.n++;
      sums.forEach((s, i) => { t.v[i][0] += s.cur(r) || 0; t.v[i][1] += s.prev ? s.prev(r) || 0 : 0; });
    }
    const list = Object.values(g).sort((a, b) => b.v[0][0] - a.v[0][0]);
    return `<details ${list.length > 1 ? 'open' : ''}><summary class="small"><b>By category</b> <span class="muted">(${list.length}) — click a row to filter</span></summary>
      <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Category</th><th class="num">Pages</th>${sums.map((s) => `<th class="num">${esc(s.label)}</th>`).join('')}</tr></thead><tbody>
      ${list.slice(0, 60).map((t) => `<tr class="click" data-catpick="${esc(t.type)}|${esc(t.topic)}"><td><b>${esc(t.type)}</b> · ${esc(t.topic)}</td><td class="num">${fmt(t.n)}</td>${t.v.map(([c, p], i) => `<td class="num">${sums[i].prev ? dcell(c, p) : fmt(c)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></details>`;
  };
  const bar = () => `<div class="row" style="margin-bottom:10px">
      <select data-cv="type" style="width:auto">${opts(countBy((r) => r.__cat.type, rows), st.type, 'All page types')}</select>
      <select data-cv="topic" style="width:auto">${opts(countBy((r) => r.__cat.topic, rows.filter((r) => !st.type || r.__cat.type === st.type)), st.topic, 'All topics')}</select>
      <select data-cv="top" style="width:auto">${[['', 'All pages'], ...[3, 5, 10, 25, 50, 100, 250].map((n) => [String(n), `Top ${n} by ${main.label.toLowerCase()}`])].map(([v, l]) => `<option value="${v}" ${v === st.top ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${st.type || st.topic || st.top ? '<button class="btn sm" data-cv="reset">Clear filters</button>' : ''}
      <span class="small muted">${fmt(filtered().length)} of ${fmt(rows.length)} pages</span></div>`;
  const draw = () => {
    const root = document.getElementById('cv-' + key);
    if (!root) return;
    root.querySelector('.cv-bar').innerHTML = bar();
    root.querySelector('.cv-sum').innerHTML = summary();
    root.querySelector('.cv-tab').innerHTML = renderTable(filtered());
    bind();
  };
  const bind = () => {
    const root = document.getElementById('cv-' + key);
    if (!root) return;
    root.querySelectorAll('select[data-cv]').forEach((el) => (el.onchange = () => { st[el.dataset.cv] = el.value; if (el.dataset.cv === 'type') st.topic = ''; draw(); }));
    root.querySelector('[data-cv="reset"]')?.addEventListener('click', () => { st.type = st.topic = st.top = ''; draw(); });
    root.querySelectorAll('[data-catpick]').forEach((el) => (el.onclick = () => { [st.type, st.topic] = el.dataset.catpick.split('|'); draw(); }));
  };
  setTimeout(bind);
  return `<div id="cv-${key}"><div class="cv-bar">${bar()}</div><div class="cv-sum card" style="padding:12px;margin-bottom:12px;box-shadow:none">${summary()}</div><div class="cv-tab">${renderTable(filtered())}</div></div>`;
}

// ---------- AI answer visibility (Gemini + Google Search grounding) ----------
const dom = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
async function loadAiVisibility(pid, run, pages) {
  const box = document.getElementById('aivis');
  if (!box) return;
  let data;
  try { data = await api(`/api/projects/${pid}/ai-prompts`); } catch (e) { box.innerHTML = `<div class="banner err">${esc(e.message)}</div>`; return; }
  const latest = {};
  const hist = {};
  for (const c of data.checks) { (hist[c.prompt_id] ||= []).push(c); if (!latest[c.prompt_id]) latest[c.prompt_id] = c; }
  const done = data.prompts.filter((p) => latest[p.id] && !latest[p.id].error);
  const citedN = done.filter((p) => latest[p.id].cited).length, mentN = done.filter((p) => latest[p.id].mentioned).length;
  const compet = {};
  for (const p of done) for (const s0 of latest[p.id].sources) { const d = (s0.title || dom(s0.uri)).toLowerCase(); compet[d] = (compet[d] || 0) + 1; }
  const topDomains = Object.entries(compet).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const isB = brandTester(run.summary.brand?.terms);
  const suggest = (run.gsc?.queries || []).filter((q) => !isB(q.q) && q.q.split(' ').length >= 2).sort((a, b) => b.i - a.i).slice(0, 10).map((q) => q.q);
  const yes = (v) => (v ? '<span class="pill good">Yes</span>' : '<span class="pill bad">No</span>');
  box.innerHTML = `<div class="card section"><h2>📣 AI answer visibility — Gemini + Google Search</h2>
    <p class="muted small">For each prompt, Searchverse asks <b>Gemini with live Google Search</b> (the same grounding behind Google's AI answers), using your free Gemini key, and records the model version, the full answer, every source it cited, and whether your site is cited or your brand mentioned. ChatGPT, Perplexity and Claude aren't included — their APIs are paid. Free Gemini limits apply (a few dozen prompts a day is fine).</p>
    ${done.length ? `<div class="grid kpis section">
      <div class="card kpi"><div class="label">Prompts tracked</div><div class="value">${data.prompts.length}</div></div>
      <div class="card kpi"><div class="label">Your site cited</div><div class="value">${citedN}/${done.length}</div><span class="small muted">${pct(citedN / done.length, 0)} of latest answers</span></div>
      <div class="card kpi"><div class="label">Brand mentioned</div><div class="value">${mentN}/${done.length}</div><span class="small muted">${pct(mentN / done.length, 0)} of latest answers</span></div>
    </div>
    <p class="small"><b>Most-cited sites:</b> ${topDomains.map(([d, n]) => `<span class="pill ${d.includes(dom(run.gsc?.pages?.[0]?.u || '')) ? 'good' : ''}">${esc(d)} · ${n}</span>`).join(' ')}</p>` : ''}
    ${data.canRun ? `<div class="row" style="align-items:flex-start;margin:12px 0"><textarea id="ai-new" rows="3" style="flex:1" placeholder="One prompt per line, e.g.&#10;best broadband plans in Delhi under 1000&#10;which postpaid plan has the most data"></textarea>
      <div style="display:flex;flex-direction:column;gap:6px"><button class="btn" id="ai-add">+ Add prompts</button>${suggest.length ? '<button class="btn sm" id="ai-suggest">Suggest from my top non-branded queries</button>' : ''}<button class="btn primary" id="ai-run" ${data.prompts.length ? '' : 'disabled'}>▶ Check all prompts</button></div></div>
      <div id="ai-prog" class="small muted"></div>` : ''}
    ${data.prompts.length ? table([
      { key: 'prompt', label: 'Prompt', render: (p) => `<b>${esc(p.prompt)}</b>` },
      { key: 'model', label: 'Model / date', render: (p) => (latest[p.id] ? `<span class="small">${esc(latest[p.id].model || '')}<br><span class="muted">${date(latest[p.id].run_at)}</span></span>` : '<span class="muted small">not checked yet</span>') },
      { key: 'cited', label: 'Site cited', render: (p) => (latest[p.id] ? (latest[p.id].error ? `<span class="pill warn" title="${esc(latest[p.id].error)}">error</span>` : yes(latest[p.id].cited)) : '–'), sort: (p) => latest[p.id]?.cited ?? -1 },
      { key: 'ment', label: 'Brand mentioned', render: (p) => (latest[p.id] && !latest[p.id].error ? yes(latest[p.id].mentioned) : '–'), sort: (p) => latest[p.id]?.mentioned ?? -1 },
      { key: 'src', label: 'Top sources', render: (p) => (latest[p.id]?.sources || []).slice(0, 4).map((x) => `<span class="pill">${esc(x.title || dom(x.uri))}</span>`).join(' ') },
      { key: 'h', label: 'History', render: (p) => (hist[p.id] || []).slice(0, 8).reverse().map((c) => `<span title="${date(c.run_at)}" class="dot ${c.error ? 'warn' : c.cited ? 'good' : 'bad'}" style="display:inline-grid;width:12px;height:12px;margin-right:2px"></span>`).join('') },
      { key: 'x', label: '', render: (p) => `${latest[p.id] ? `<button class="btn sm" data-aiview="${p.id}">View answer</button>` : ''} ${data.canRun ? `<button class="btn sm danger" data-aidel="${p.id}">✕</button>` : ''}` },
    ], data.prompts, { filter: false }) : '<p class="muted">No prompts yet. Add the questions your customers ask AI assistants.</p>'}
    <p class="hint">“Site cited” = your domain is among the sources Gemini used. “Brand mentioned” = your brand terms appear in the answer. History dots: green cited · red not cited.</p></div>`;
  const $ = (i) => document.getElementById(i);
  $('ai-suggest')?.addEventListener('click', () => { $('ai-new').value = suggest.join('\n'); });
  $('ai-add')?.addEventListener('click', async () => { try { await api(`/api/projects/${pid}/ai-prompts`, { method: 'POST', body: { prompts: $('ai-new').value } }); loadAiVisibility(pid, run, pages); } catch (e) { toast(e.message); } });
  box.querySelectorAll('[data-aidel]').forEach((b) => (b.onclick = async () => { if (!confirm('Remove this prompt and its history?')) return; await api(`/api/projects/${pid}/ai-prompts`, { method: 'DELETE', body: { id: b.dataset.aidel } }); loadAiVisibility(pid, run, pages); }));
  box.querySelectorAll('[data-aiview]').forEach((b) => (b.onclick = () => {
    const p = data.prompts.find((x) => x.id === b.dataset.aiview), c = latest[p.id];
    openDrawer(`<h2>${esc(p.prompt)}</h2><div class="muted small">${esc(c.engine)} · model <b>${esc(c.model)}</b> · ${date(c.run_at)}</div>
      <div class="row section">${yes(c.cited)} <span class="small">site cited</span> ${yes(c.mentioned)} <span class="small">brand mentioned</span></div>
      ${c.error ? `<div class="banner err">${esc(c.error)}</div>` : ''}
      ${c.search_queries.length ? `<p class="small"><b>Google searches Gemini ran:</b> ${c.search_queries.map((q) => `<span class="pill">${esc(q)}</span>`).join(' ')}</p>` : ''}
      <div class="card section"><h3>Answer</h3><div style="white-space:pre-wrap">${esc(c.answer || '—')}</div></div>
      <div class="card section"><h3>Sources cited (${c.sources.length})</h3>${c.sources.map((x, i) => `<div class="check"><span class="pill">${i + 1}</span><div><b>${esc(x.title || dom(x.uri))}</b>${x.uri ? `<div class="small"><a href="${esc(x.uri)}" target="_blank" rel="noopener">open source</a></div>` : ''}</div></div>`).join('') || '<p class="muted">No sources</p>'}</div>
      ${(hist[p.id] || []).length > 1 ? `<div class="card section"><h3>History</h3>${table([{ key: 'run_at', label: 'Date', render: (h) => date(h.run_at) }, { key: 'model', label: 'Model' }, { key: 'cited', label: 'Cited', render: (h) => (h.error ? 'error' : yes(h.cited)) }, { key: 'mentioned', label: 'Mentioned', render: (h) => (h.error ? '' : yes(h.mentioned)) }, { key: 'n', label: 'Sources', num: 1, render: (h) => h.sources.length }], hist[p.id], { filter: false })}</div>` : ''}`);
  }));
  $('ai-run')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const ids = data.prompts.map((p) => p.id);
    try {
      for (let i = 0; i < ids.length; i += 3) {
        $('ai-prog').textContent = `Asking Gemini… ${Math.min(ids.length, i + 3)}/${ids.length}`;
        await api(`/api/projects/${pid}/ai-prompts/check`, { method: 'POST', body: { ids: ids.slice(i, i + 3) } });
      }
      toast('AI visibility updated');
    } catch (err) { toast(err.message, 7000); }
    loadAiVisibility(pid, run, pages);
  });
}

function geoSection(p) {
  if (!p.geo) return '';
  return `<div class="card section"><h3>🤖 AI search readiness — ${p.geo.score}/100</h3>${p.geo.checks.map((c) => `<div class="check"><span class="dot ${c.val >= 1 ? 'good' : c.val > 0 ? 'warn' : 'bad'}">${c.val >= 1 ? '✓' : c.val > 0 ? '!' : '✗'}</span><div><div>${esc(c.label)}</div><div class="small muted">${esc(c.detail)}</div></div></div>`).join('')}</div>`;
}

// ---------- Insights: clickable bullets → the pages & queries behind each point ----------
let insightCtx = null;
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-ins]');
  if (!el || !insightCtx) return;
  e.preventDefault();
  const [sec, i] = el.dataset.ins.split(':');
  insightDrawer(sec, insightCtx.run.ai?.[sec]?.[+i] || {}, insightCtx.run, insightCtx.pages, insightCtx.project);
});
const SEC_TITLE = { what_went_well: '✅ What went well', how_we_achieved_it: '🏗️ How we achieved it', what_didnt_work: "⚠️ What didn't work", how_to_improve: '📈 How we can improve' };
function insightDrawer(sec, item, run, pages, project) {
  const g = run.gsc || {};
  const pathOf = (u) => { try { return new URL(u, project.site_url).pathname.replace(/\/$/, '') || '/'; } catch { return u; } };
  const byPath = (list) => { const m = {}; for (const r of list || []) { const k = pathOf(r.u); (m[k] ||= { c: 0, i: 0, pw: 0, u: r.u }); m[k].c += r.c; m[k].i += r.i; m[k].pw += r.p * r.i; } return m; };
  const cur = byPath(g.pages), prev = byPath(g.prevPages);
  const crawled = Object.fromEntries(pages.map((p) => [pathOf(p.url), p]));
  const qCur = Object.fromEntries((g.queries || []).map((q) => [q.q.toLowerCase(), q])), qPrev = Object.fromEntries((g.prevQueries || []).map((q) => [q.q.toLowerCase(), q]));
  const m = run.summary ? moversFor(run, pages) : null;
  // pages/queries named by the AI; if it named none, fall back to the matching data (gainers, losers or weak pages)
  let urls = (item.pages || []).filter(Boolean);
  let qs = (item.queries || []).filter(Boolean);
  if (!urls.length && m) urls = (sec === 'what_didnt_work' ? m.pagesDown : sec === 'how_to_improve' ? pages.filter((p) => p.content_score < 60).sort((a, b) => (b.gsc?.i || 0) - (a.gsc?.i || 0)).map((p) => ({ k: p.url })) : m.pagesUp).slice(0, 15).map((r) => r.k);
  if (!qs.length && m) qs = (sec === 'what_didnt_work' ? m.queriesDown : m.queriesUp).filter((r) => !r.b).slice(0, 15).map((r) => r.k);
  const prows = urls.map((u) => { const k = pathOf(u), c = cur[k], p = prev[k], cp = crawled[k]; return { u: c?.u || new URL(u, project.site_url).href, c: c?.c ?? null, pc: p?.c ?? null, i: c?.i ?? null, pos: c?.i ? c.pw / c.i : null, ppos: p?.i ? p.pw / p.i : null, on: cp?.onpage_score ?? null, ct: cp?.content_score ?? null }; });
  const qrows = qs.map((q) => { const c = qCur[q.toLowerCase()], p = qPrev[q.toLowerCase()]; return { q, c: c?.c ?? null, pc: p?.c ?? null, i: c?.i ?? null, pos: c?.p ?? null, ppos: p?.p ?? null }; });
  openDrawer(`<div class="small muted">${SEC_TITLE[sec] || ''} · ${esc(CMP.cur)} vs ${esc(CMP.prev)}</div><h2>${esc(item.point || '')}</h2>
    ${item.evidence ? `<p>📊 ${esc(item.evidence)}</p>` : ''}${item.likely_cause ? `<p>🔍 <b>Likely cause:</b> ${esc(item.likely_cause)}</p>` : ''}
    <div class="card section"><h3>Pages (${prows.length})</h3>${table([
      { key: 'u', label: 'Page', render: (r) => pageLink(r.u, pages) },
      { key: 'c', label: `Clicks ${esc(CMP.cur)}`, num: 1, render: (r) => fmt(r.c) },
      { key: 'pc', label: esc(CMP.prev), num: 1, render: (r) => `<span class="muted">${fmt(r.pc)}</span>` },
      { key: 'd', label: 'Δ', num: 1, render: (r) => delta(r.c, r.pc), sort: (r) => (r.c || 0) - (r.pc || 0) },
      { key: 'pos', label: 'Pos', num: 1, render: (r) => `${fmt(r.pos, 1)} <span class="small muted">(${fmt(r.ppos, 1)})</span>` },
      { key: 'on', label: 'On-page', num: 1, render: (r) => (r.on == null ? '–' : `<span class="pill ${pillFor(r.on)}">${r.on}</span>`) },
      { key: 'ct', label: 'Content', num: 1, render: (r) => (r.ct == null ? '–' : `<span class="pill ${pillFor(r.ct)}">${r.ct}</span>`) },
    ], prows, { filter: false })}</div>
    <div class="card section"><h3>Queries (${qrows.length})</h3>${table([
      { key: 'q', label: 'Query', render: (r) => `<b>${esc(r.q)}</b>` },
      { key: 'c', label: `Clicks ${esc(CMP.cur)}`, num: 1, render: (r) => fmt(r.c) },
      { key: 'pc', label: esc(CMP.prev), num: 1, render: (r) => `<span class="muted">${fmt(r.pc)}</span>` },
      { key: 'd', label: 'Δ', num: 1, render: (r) => delta(r.c, r.pc), sort: (r) => (r.c || 0) - (r.pc || 0) },
      { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) },
      { key: 'pos', label: 'Pos', num: 1, render: (r) => `${fmt(r.pos, 1)} <span class="small muted">(${fmt(r.ppos, 1)})</span>` },
    ], qrows, { filter: false })}${item.pages?.length || item.queries?.length ? '' : '<p class="hint">The AI named no specific pages/queries here, so this shows the matching gainers/losers from the data.</p>'}</div>`);
}

// ---------- Rendering: SSR vs CSR ----------
function viewRendering(run, pages) {
  const ok = pages.filter((p) => p.meta?.renderMode);
  if (!ok.length) return '<div class="card center"><h2>Run a new analysis</h2><p class="muted">Rendering is checked during the crawl.</p></div>';
  const by = {};
  for (const p of ok) { const t = (by[p.meta.renderMode] ||= { n: 0, c: 0, i: 0, money: 0 }); t.n++; t.c += p.gsc?.c || 0; t.i += p.gsc?.i || 0; if (p.money) t.money++; }
  const fw = {};
  for (const p of ok) fw[p.meta.framework || 'None detected'] = (fw[p.meta.framework || 'None detected'] || 0) + 1;
  const csr = ok.filter((p) => p.meta.renderMode === 'CSR').sort((a, b) => (b.money - a.money) || (b.gsc?.i || 0) - (a.gsc?.i || 0));
  const totI = ok.reduce((t, p) => t + (p.gsc?.i || 0), 0) || 1;
  const pill = (m) => `<span class="pill ${m === 'CSR' ? 'bad' : m === 'SSR (framework)' ? 'info' : 'good'}">${esc(m)}</span>`;
  return `<div class="grid kpis">${['SSR / static', 'SSR (framework)', 'CSR'].map((m) => `<div class="card kpi"><div class="label">${pill(m)}</div><div class="value">${fmt(by[m]?.n || 0)}</div><span class="small muted">${pct((by[m]?.i || 0) / totI)} of impressions${by[m]?.money ? ` · 💰${by[m].money}` : ''}</span></div>`).join('')}</div>
    <div class="card section"><h2>What this means</h2>
      <ul class="small"><li><b>SSR / static</b> — the content is in the HTML Google and AI crawlers receive. ✅ Best.</li>
      <li><b>SSR (framework)</b> — a JavaScript framework (${esc(Object.keys(fw).filter((k) => k !== 'None detected').join(', ') || 'e.g. Next.js')}) that still sends the content in the HTML. ✅ Fine.</li>
      <li><b>CSR</b> — the HTML is nearly empty and the content appears only after JavaScript runs. Google renders it later (slower, less reliable); most AI crawlers (ChatGPT, Perplexity, Claude) don't run JavaScript at all, so they see an empty page. ❌ Needs dev work.</li></ul>
      <p class="small">Frameworks seen: ${Object.entries(fw).map(([k, v]) => `<span class="pill">${esc(k)} · ${v}</span>`).join(' ')}</p></div>
    ${csr.length ? `<div class="card section"><h2>❌ Client-rendered pages to fix (${csr.length})</h2>
      <p class="small"><b>Fix (dev):</b> switch these templates to server-side rendering or static generation (e.g. Next.js SSR/SSG), or add pre-rendering for bots; make sure title, H1, main copy and internal links are in the first HTML response. <b>Check it worked:</b> “View source” shows the text, and this tab moves the page to SSR on the next run.</p>
      ${table([{ key: 'url', label: 'Page', render: (p) => `${p.money ? '💰 ' : ''}${pageLink(p.url, pages)}` }, { key: 'i', label: 'Impr.', num: 1, render: (p) => fmt(p.gsc?.i), sort: (p) => p.gsc?.i || 0 }, { key: 'c', label: 'Clicks', num: 1, render: (p) => fmt(p.gsc?.c), sort: (p) => p.gsc?.c || 0 }, { key: 'w', label: 'Words in HTML', num: 1, render: (p) => fmt(p.meta.wordCount) }, { key: 's', label: 'Scripts', num: 1, render: (p) => fmt(p.meta.scripts) }, { key: 'f', label: 'Framework', render: (p) => esc(p.meta.framework || '–') }], csr, { filter: false })}</div>`
      : '<div class="card section center"><h2>🎉 No client-rendered pages found</h2><p class="muted">All crawled pages send their content in the HTML.</p></div>'}
    <div class="card section"><h2>All crawled pages</h2>${table([
      { key: 'url', label: 'Page', render: (p) => `${p.money ? '💰 ' : ''}<span class="url" style="display:inline-block">${esc(shortUrl(p.url))}</span>`, text: (p) => p.url + ' ' + p.meta.renderMode },
      { key: 'm', label: 'Rendering', render: (p) => pill(p.meta.renderMode), sort: (p) => p.meta.renderMode },
      { key: 'f', label: 'Framework', render: (p) => esc(p.meta.framework || '–') },
      { key: 'w', label: 'Words in HTML', num: 1, render: (p) => fmt(p.meta.wordCount), sort: (p) => p.meta.wordCount },
      { key: 's', label: 'Scripts', num: 1, render: (p) => fmt(p.meta.scripts), sort: (p) => p.meta.scripts },
      { key: 'i', label: 'Impr.', num: 1, render: (p) => fmt(p.gsc?.i), sort: (p) => p.gsc?.i || 0 },
    ], ok, { limit: 1000, onRow: (p) => pageDetail(p, run) })}</div>`;
}

// ---------- Trust signals per page ----------
function trustSignals(pages) {
  const ok = pages.filter((p) => p.meta);
  const sig = [
    ['about', 'About page linked', (p) => p.meta.trustLinks?.about, 'Add an “About us” link to the global footer (and header if possible) so every page links to it.'],
    ['contact', 'Contact / support linked', (p) => p.meta.trustLinks?.contact, 'Add “Contact us” / “Help & support” to the global footer.'],
    ['privacy', 'Privacy policy linked', (p) => p.meta.trustLinks?.privacy, 'Add “Privacy policy” to the global footer.'],
    ['org', 'Organization schema', (p) => (p.meta.schemaTypes || []).some((t) => /Organization|Corporation|LocalBusiness/i.test(t)), 'Add Organization JSON-LD (name, logo, url, contactPoint, sameAs) site-wide or at least on the homepage.'],
    ['sameas', 'sameAs social/profile links in schema', (p) => (p.meta.sameAs || 0) > 0, 'In the Organization schema add sameAs: official Wikipedia, LinkedIn, X/Twitter, Facebook, Instagram, YouTube URLs.'],
    ['author', 'Author / byline', (p) => p.meta.hasAuthor, 'Show the author (or team/editorial name) with a link to an author page — most important on blogs/guides.'],
    ['date', 'Published / updated date', (p) => !!p.meta.lastDate, 'Show “Updated on …” and add datePublished / dateModified in Article schema.'],
  ];
  return sig.map(([id, label, test, fix]) => {
    const missing = ok.filter((p) => !test(p)).sort((a, b) => (b.money - a.money) || (b.gsc?.i || 0) - (a.gsc?.i || 0));
    return { id, label, fix, have: ok.length - missing.length, n: ok.length, missing };
  });
}

function viewGscGa(run, pages, project) {
  const s = run.summary, g = run.gsc, ga = run.ga, match = scopeOf(s);
  const origin = new URL(run.gsc.pages[0]?.u || 'https://x.invalid').origin;
  const rows = {};
  const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };
  const get = (u) => (rows[pathOf(u)] ||= { path: pathOf(u), url: u, c: 0, pc: 0, i: 0, pi: 0, pw: 0, ppw: 0, s: 0, ps: 0, ke: 0, pke: 0, bs: 0, pbs: 0, nu: 0 });
  for (const [list, pre] of [[g.pages, ''], [g.prevPages, 'p']]) for (const r of list) { if (match && !match(r.u)) continue; const x = get(r.u); x[pre + 'c'] += r.c; x[pre + 'i'] += r.i; x[pre + 'pw'] += r.p * r.i; }
  for (const [list, pre] of [[ga?.landing || [], ''], [ga?.prevLanding || [], 'p']]) for (const l of list) {
    const u = origin + l.path.split('?')[0]; if (match && !match(u)) continue;
    const x = get(u); x[pre + 's'] += l.sessions; x[pre + 'ke'] += l.keyEvents; x[pre + 'bs'] += (l.bounceRate || 0) * l.sessions; if (!pre) x.nu += l.newUsers || 0;
  }
  const crawled = Object.fromEntries(pages.map((p) => [pathOf(p.url), p]));
  const list = Object.values(rows).map((x) => ({ ...x, p: x.i ? x.pw / x.i : null, pp: x.pi ? x.ppw / x.pi : null, br: x.s ? x.bs / x.s : null, pbr: x.ps ? x.pbs / x.ps : null, onpage: crawled[x.path]?.onpage_score ?? null, money: crawled[x.path]?.money }))
    .sort((a, b) => b.c - a.c || b.s - a.s);
  const hasPrevGa = !!ga?.prevLanding;
  return `<div class="card"><h2>Search Console + GA4 by page</h2><p class="muted small">${run.start_date} → ${run.end_date} vs ${run.prev_start} → ${run.prev_end}${s.scope ? ' · ' + esc(s.scope) : ''}. Pages are matched to GA4 organic landing pages by path.${ga && !hasPrevGa ? ' Run a new analysis to get GA4 comparison numbers.' : ''}</p>
    ${catView('gscga', list, (x) => x.url, [
      { label: 'Clicks', cur: (x) => x.c, prev: (x) => x.pc }, { label: 'Impressions', cur: (x) => x.i, prev: (x) => x.pi },
      ...(ga ? [{ label: 'Organic sessions', cur: (x) => x.s, prev: (x) => (hasPrevGa ? x.ps : 0) }] : []),
    ], (list) => table([
      { key: 'path', label: 'Page', render: (x) => `${x.money ? '💰 ' : ''}<span class="url" style="display:inline-block">${esc(x.path)}</span><div class="small muted">${esc(x.__cat.label)}</div>`, text: (x) => x.path + ' ' + x.__cat.label + (x.money ? ' money' : '') },
      { key: 'c', label: 'Clicks', num: 1, render: (x) => dcell(x.c, x.pc) },
      { key: 'i', label: 'Impr.', num: 1, render: (x) => dcell(x.i, x.pi) },
      { key: 'p', label: 'Pos', num: 1, render: (x) => dcell(x.p, x.pp, (v) => fmt(v, 1), { invert: true }), sort: (x) => x.p ?? 999 },
      ...(ga ? [
        { key: 's', label: 'Sessions', num: 1, render: (x) => dcell(x.s, hasPrevGa ? x.ps : null) },
        { key: 'nu', label: 'New users', num: 1, render: (x) => fmt(x.nu) },
        { key: 'br', label: 'Bounce', num: 1, render: (x) => (x.br == null ? '–' : dcell(x.br, x.pbr, (v) => pct(v), { invert: true, isPct: true })), sort: (x) => x.br ?? -1 },
        { key: 'ke', label: 'Key events', num: 1, render: (x) => dcell(x.ke, hasPrevGa ? x.pke : null) },
      ] : []),
      { key: 'onpage', label: 'On-page', num: 1, render: (x) => (x.onpage == null ? '<span class="muted">–</span>' : `<span class="pill ${pillFor(x.onpage)}">${x.onpage}</span>`), sort: (x) => x.onpage ?? -1 },
    ], list, { limit: 1000, onRow: (x) => urlQueries(project.id, project, { url: x.url, lob: '', ga: x.s ? 1 : null, s: x.s, br: x.br, ke: x.ke },
      { start: run.start_date, end: run.end_date }, { start: run.prev_start, end: run.prev_end }, brandTester(s.brand?.terms || project.brand_terms)) }))}
    <p class="hint">Click a page to see its queries (non-branded first).</p></div>`;
}

function moversTables(m, pages) {
  const pctCh = (r) => (r.pc ? ((r.c - r.pc) / r.pc) * 100 : null);
  const common = [
    { key: 'c', label: `Clicks ${esc(CMP.cur)}`, num: 1, render: (r) => fmt(r.c) },
    { key: 'pc', label: esc(CMP.prev), num: 1, render: (r) => `<span class="muted">${fmt(r.pc)}</span>` },
    { key: 'd', label: 'Δ', num: 1, render: (r) => `<b class="${r.d >= 0 ? 'up' : 'down'}">${r.d >= 0 ? '+' : ''}${fmt(r.d)}</b>` },
    { key: 'dp', label: 'Δ %', num: 1, render: (r) => (pctCh(r) == null ? '<span class="muted">new</span>' : `<span class="${r.d >= 0 ? 'up' : 'down'}">${pctCh(r) >= 0 ? '+' : ''}${fmt(pctCh(r), 1)}%</span>`), sort: (r) => pctCh(r) ?? 1e9 },
    { key: 'p', label: 'Pos', num: 1, render: (r) => `${r.p == null ? '–' : fmt(r.p, 1)} <span class="muted small">(${r.pp == null ? '–' : fmt(r.pp, 1)})</span>`, sort: (r) => r.p ?? 999 },
  ];
  const qt = (rows) => table([{ key: 'k', label: 'Query', render: (r) => `${esc(r.k)} ${r.b ? '<span class="pill info">Branded</span>' : ''}` }, ...common], rows, { filter: false });
  const pt = (rows) => table([{ key: 'k', label: 'Page', render: (r) => `<span class="url" style="display:inline-block;max-width:260px">${pageLink(r.k, pages)}</span>` }, ...common,
    { key: 'onpage', label: 'On-page', num: 1, render: (r) => (r.onpage == null ? '–' : `<span class="pill ${pillFor(r.onpage)}">${r.onpage}</span>`), sort: (r) => r.onpage ?? -1 }], rows, { filter: false });
  const qs = m.queryStats, ps = m.pageStats;
  return `<div class="grid kpis section">
      <div class="card kpi"><div class="label">Queries growing</div><div class="value up">${fmt(qs.up)}</div><span class="small muted">+${fmt(qs.gained)} clicks</span></div>
      <div class="card kpi"><div class="label">Queries declining</div><div class="value down">${fmt(qs.down)}</div><span class="small muted">${fmt(qs.lost)} clicks</span></div>
      <div class="card kpi"><div class="label">Pages growing</div><div class="value up">${fmt(ps.up)}</div><span class="small muted">+${fmt(ps.gained)} clicks${m.winnersAvgOnpage != null ? ` · avg on-page ${m.winnersAvgOnpage}` : ''}</span></div>
      <div class="card kpi"><div class="label">Pages declining</div><div class="value down">${fmt(ps.down)}</div><span class="small muted">${fmt(ps.lost)} clicks${m.losersAvgOnpage != null ? ` · avg on-page ${m.losersAvgOnpage}` : ''}</span></div>
    </div>
    <p class="small muted section">${esc(CMP.cur)} vs ${esc(CMP.prev)} · brackets show the earlier position</p>
    <div class="card section"><h2>📈 Top gaining queries</h2>${qt(m.queriesUp)}</div><div class="card section"><h2>📉 Top losing queries</h2>${qt(m.queriesDown)}</div>
    <div class="card section"><h2>📈 Top gaining pages</h2>${pt(m.pagesUp)}</div><div class="card section"><h2>📉 Top losing pages</h2>${pt(m.pagesDown)}</div>`;
}

function viewGsc(run, pages) {
  const s = run.summary, g = run.gsc;
  const inR = (d, a, b) => d >= a && d <= b;
  const cur = g.daily.filter((d) => inR(d.d, run.start_date, run.end_date)), prev = g.daily.filter((d) => inR(d.d, run.prev_start, run.prev_end));
  const pb = s.prevBrand;
  return `<div class="card"><h2>Clicks: current vs comparison</h2>${lineChart([
      { name: `Clicks ${run.start_date} → ${run.end_date}`, values: cur.map((d) => d.c), color: 'var(--primary)', axis: true },
      { name: `Clicks ${run.prev_start} → ${run.prev_end}`, values: prev.map((d) => d.c), color: 'var(--muted)', dash: true },
    ], { labels: cur.map((d) => d.d.slice(5)) })}</div>
    ${s.brand ? `<div class="card section"><h2>Branded vs non-branded</h2><div class="table-wrap"><table><thead><tr><th></th><th class="num">Clicks</th><th class="num">Impressions</th><th class="num">Queries</th></tr></thead><tbody>
      ${[['Non-branded', 'nonBranded'], ['Branded', 'branded']].map(([l, k]) => `<tr><td><b>${l}</b></td><td class="num">${dcell(s.brand[k].c, pb?.[k]?.c)}</td><td class="num">${dcell(s.brand[k].i, pb?.[k]?.i)}</td><td class="num">${fmt(s.brand[k].n)}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Brand terms: ${esc(s.brand.terms)}${s.scope ? ' · LOB scope' : ''}</p></div>` : ''}
    ${moversTables(moversFor(run, pages), pages)}
    <div class="grid g2 section"><div class="card"><h2>Devices</h2>${table([{ key: 'k', label: 'Device' }, { key: 'c', label: 'Clicks', num: 1, render: (r) => fmt(r.c) }, { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) }, { key: 'ctr', label: 'CTR', num: 1, render: (r) => pct(r.ctr) }, { key: 'p', label: 'Pos', num: 1 }], g.devices, { filter: false })}</div>
      <div class="card"><h2>Top countries</h2>${table([{ key: 'k', label: 'Country', render: (r) => esc(r.k.toUpperCase()) }, { key: 'c', label: 'Clicks', num: 1, render: (r) => fmt(r.c) }, { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) }, { key: 'p', label: 'Pos', num: 1 }], g.countries, { filter: false })}</div></div>
    <h2 class="section">All queries${s.scope ? ' <span class="muted small">(whole site)</span>' : ''}</h2>${viewQueries(g, run)}`;
}

function viewGa(run) {
  const ga = run.ga, s = run.summary, match = scopeOf(s);
  if (!ga) return '<div class="card center muted">No GA4 property connected to this project.</div>';
  const inR = (d, a, b) => d >= a && d <= b;
  const gcur = ga.daily.filter((d) => inR(d.d, run.start_date, run.end_date)), gprev = ga.daily.filter((d) => inR(d.d, run.prev_start, run.prev_end));
  const origin = new URL(run.gsc.pages[0]?.u || 'https://x.invalid').origin;
  const prev = Object.fromEntries((ga.prevLanding || []).map((l) => [l.path, l]));
  const rows = ga.landing.filter((l) => !match || match(origin + l.path.split('?')[0])).map((l) => ({ ...l, p: prev[l.path] || null }));
  const hp = !!ga.prevLanding;
  return `<div class="card"><h2>Organic sessions: current vs comparison</h2>${lineChart([{ name: 'Sessions', values: gcur.map((d) => d.s), color: 'var(--good)', axis: true }, { name: 'Comparison period', values: gprev.map((d) => d.s), color: 'var(--muted)', dash: true }], { labels: gcur.map((d) => d.d.slice(5)) })}</div>
    <div class="card section"><h2>Organic Search summary</h2>${table([{ key: 'name', label: 'Channel' }, { key: 's', label: 'Sessions', num: 1, render: (r) => dcell(r.cur?.sessions, r.prev?.sessions), sort: (r) => r.cur?.sessions || 0 }, { key: 'u', label: 'Users', num: 1, render: (r) => dcell(r.cur?.users, r.prev?.users), sort: (r) => r.cur?.users || 0 }, { key: 'e', label: 'Engagement', num: 1, render: (r) => dcell(r.cur?.engagementRate, r.prev?.engagementRate, (v) => pct(v), { isPct: true }), sort: (r) => r.cur?.engagementRate || 0 }, { key: 'k', label: 'Key events', num: 1, render: (r) => dcell(r.cur?.keyEvents, r.prev?.keyEvents), sort: (r) => r.cur?.keyEvents || 0 }], ga.channels.filter((c) => c.name === 'Organic Search'), { filter: false })}</div>
    <div class="card section"><h2>Organic landing pages${s.scope ? ' · ' + esc(s.scope) : ''}</h2>${table([
      { key: 'path', label: 'Landing page', render: (r) => `<span class="url" style="display:inline-block">${esc(r.path)}</span>` },
      { key: 'sessions', label: 'Sessions', num: 1, render: (r) => dcell(r.sessions, hp ? r.p?.sessions ?? 0 : null) },
      { key: 'newUsers', label: 'New users', num: 1, render: (r) => dcell(r.newUsers, r.p?.newUsers) },
      { key: 'ret', label: 'Returning', num: 1, render: (r) => fmt(Math.max(0, (r.users || 0) - (r.newUsers || 0))), sort: (r) => (r.users || 0) - (r.newUsers || 0) },
      { key: 'bounceRate', label: 'Bounce', num: 1, render: (r) => dcell(r.bounceRate, r.p?.bounceRate, (v) => pct(v), { invert: true, isPct: true }) },
      { key: 'engagementRate', label: 'Engaged', num: 1, render: (r) => pct(r.engagementRate) },
      { key: 'views', label: 'Views', num: 1, render: (r) => fmt(r.views) },
      { key: 'keyEvents', label: 'Key events', num: 1, render: (r) => dcell(r.keyEvents, hp ? r.p?.keyEvents ?? 0 : null) },
    ], rows, { limit: 1000 })}${hp ? '' : '<p class="hint">Run a new analysis to get comparison numbers here.</p>'}</div>`;
}

function viewQuick(o, pages) {
  const sec = (title, desc, html) => `<div class="card section"><h2>${title}</h2><p class="muted small">${desc}</p>${html}</div>`;
  const pg = (u) => (u ? pageLink(u, pages) : '–');
  return sec('🚀 Striking distance (positions 4–15)', 'High-impression queries just off the top spots — the fastest traffic gains.',
    table([{ key: 'q', label: 'Query' }, { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) }, { key: 'c', label: 'Clicks', num: 1, render: (r) => fmt(r.c) }, { key: 'p', label: 'Pos', num: 1 }, { key: 'page', label: 'Ranking page', render: (r) => pg(r.page) }], o.quickWins))
  + sec('✍️ Low CTR for position', 'Ranking well but under-clicked — rewrite title & meta.',
    table([{ key: 'q', label: 'Query' }, { key: 'p', label: 'Pos', num: 1 }, { key: 'ctr', label: 'CTR', num: 1, render: (r) => pct(r.ctr) }, { key: 'expected', label: 'Expected', num: 1, render: (r) => pct(r.expected, 0) }, { key: 'lostClicks', label: 'Lost clicks', num: 1 }, { key: 'page', label: 'Page', render: (r) => pg(r.page) }], o.lowCtr))
  + sec('🧩 Missing keywords on key pages', 'Queries a page ranks for that are missing from its title, H1, headings or copy.',
    table([{ key: 'q', label: 'Query' }, { key: 'u', label: 'Page', render: (r) => pg(r.u) }, { key: 'i', label: 'Impr.', num: 1, render: (r) => fmt(r.i) }, { key: 'p', label: 'Pos', num: 1 }, { key: 'score', label: 'Coverage', num: 1, render: (r) => `<span class="pill ${pillFor(r.score)}">${r.score}</span>` }, { key: 'missing', label: 'Missing from', render: (r) => esc(r.missing.join(', ')) }], o.contentGaps));
}

function viewMajor(run, pages) {
  const s = run.summary, o = s.opps;
  const sec = (title, desc, html) => `<div class="card section"><h2>${title}</h2><p class="muted small">${desc}</p>${html}</div>`;
  const pg = (u) => (u ? pageLink(u, pages) : '–');
  const weak = pages.filter((p) => p.meta && (p.gsc?.i || 0) > 0 && (p.onpage_score < 70 || p.content_score < 50)).sort((a, b) => (b.gsc?.i || 0) - (a.gsc?.i || 0)).slice(0, 25);
  const js = pages.filter((p) => p.checks.find((c) => c.id === 'js')?.val === 0);
  const ng = s.navGaps;
  return sec('🔻 Declining pages', 'Pages that lost 30%+ clicks vs the comparison period. If many fell in position together it points to a ranking/core update; otherwise check the page.',
      table([{ key: 'u', label: 'Page', render: (r) => pg(r.u) }, { key: 'c', label: 'Clicks', num: 1, render: (r) => `${fmt(r.c)} <span class="muted small">from ${fmt(r.prevC)}</span>` }, { key: 'p', label: 'Pos', num: 1, render: (r) => `${r.p} <span class="muted small">from ${r.prevP}</span>` }], o.decliningPages, { filter: false }))
    + sec('🛠️ High-impression pages with weak on-page / content scores', 'Fixing these moves the most traffic.',
      table([{ key: 'url', label: 'Page', render: (p) => pg(p.url) }, { key: 'i', label: 'Impr.', num: 1, render: (p) => fmt(p.gsc?.i), sort: (p) => p.gsc?.i || 0 }, { key: 'onpage_score', label: 'On-page', num: 1, render: (p) => `<span class="pill ${pillFor(p.onpage_score)}">${p.onpage_score}</span>` }, { key: 'content_score', label: 'Content', num: 1, render: (p) => `<span class="pill ${pillFor(p.content_score)}">${p.content_score}</span>` }, { key: 'issues', label: 'Main issues', render: (p) => esc(p.checks.filter((c) => c.val < 1).sort((a, b) => b.weight - a.weight).slice(0, 3).map((c) => c.label).join(' · ')) }], weak, { filter: false }))
    + sec('⚔️ Keyword cannibalisation', 'Several pages split impressions for one query — consolidate or differentiate.',
      table([{ key: 'q', label: 'Query' }, { key: 'total', label: 'Impr.', num: 1, render: (r) => fmt(r.total) }, { key: 'pages', label: 'Competing pages', render: (r) => r.pages.map((p) => `${pg(p.u)} <span class="muted small">${fmt(p.i)} impr · pos ${p.p}</span>`).join('<br>') }], o.cannibalization))
    + (o.lowEngagement.length ? sec('😴 Low-engagement organic landing pages (GA4)', 'Visitors from search leave quickly — CRO candidates.',
      table([{ key: 'path', label: 'Landing page' }, { key: 'sessions', label: 'Sessions', num: 1 }, { key: 'engagementRate', label: 'Engaged', num: 1, render: (r) => pct(r.engagementRate) }, { key: 'bounceRate', label: 'Bounce', num: 1, render: (r) => pct(r.bounceRate) }, { key: 'keyEvents', label: 'Key events', num: 1 }], o.lowEngagement)) : '')
    + sec('🖥️ Rendering (SSR / CSR)', 'Moved to its own tab.', '<p><a href="#" data-tab="Rendering">Open the Rendering tab →</a></p>')
    + (s.links ? sec('🔗 Internal link opportunities', 'These pages already mention the target keyword in their copy but don\'t link to the target page. Turn the mention into a link with that anchor text.',
      table([{ key: 'from', label: 'Add link on', render: (r) => pg(r.from) }, { key: 'anchor', label: 'Anchor text', render: (r) => `<b>“${esc(r.anchor)}”</b>` }, { key: 'to', label: 'Link to', render: (r) => `${r.toMoney ? '💰 ' : ''}${pg(r.to)}` }, { key: 'impressions', label: 'Target impr.', num: 1, render: (r) => fmt(r.impressions) }, { key: 'position', label: 'Target pos', num: 1, render: (r) => fmt(r.position, 1) }], s.links.suggestions, { limit: 100 })
      + `<h3 style="margin-top:18px">Pages with few internal links pointing to them</h3>` + table([{ key: 'url', label: 'Page', render: (r) => `${r.money ? '💰 ' : ''}${pg(r.url)}` }, { key: 'inbound', label: 'Inbound links (from crawled pages)', num: 1 }, { key: 'impressions', label: 'Impr.', num: 1, render: (r) => fmt(r.impressions) }], s.links.weakInbound, { filter: false })) : '')
    + (ng ? sec('🧭 Main keywords missing from top navigation & footer', `Checked ${ng.navCount} nav links and ${ng.footerCount} footer links on ${esc(ng.page)} against your LOBs and top non-branded queries.`,
      table([{ key: 'term', label: 'Keyword / LOB' }, { key: 'src', label: 'Source' }, { key: 'i', label: 'Impr.', num: 1, render: (r) => (r.i ? fmt(r.i) : '–') }, { key: 'inNav', label: 'In nav', render: (r) => mark(r.inNav ? 1 : 0) }, { key: 'inFooter', label: 'In footer', render: (r) => mark(r.inFooter ? 1 : 0) }], ng.rows, { filter: false })) : '')
    + sec('🔗 External links per page', 'Outbound external links found on crawled pages. Backlink / competitor comparison needs a backlink tool (e.g. Ahrefs, Semrush) — Search Console\'s API does not expose links.',
      table([{ key: 'url', label: 'Page', render: (p) => pg(p.url) }, { key: 'e', label: 'External links', num: 1, render: (p) => fmt(p.meta?.externalLinks), sort: (p) => p.meta?.externalLinks || 0 }, { key: 'n', label: 'Internal links', num: 1, render: (p) => fmt(p.meta?.internalLinks), sort: (p) => p.meta?.internalLinks || 0 }], pages.filter((p) => p.meta), { filter: false, limit: 50 }));
}


function viewPages(pages, project, run) {
  return `<div class="card">${catView('pages', pages, (p) => p.url, [
    { label: 'Clicks', cur: (p) => p.gsc?.c }, { label: 'Impressions', cur: (p) => p.gsc?.i },
  ], (pages) => table([
    { key: 'cat', label: 'Category', render: (p) => `<span class="small">${esc(p.__cat.label)}</span>`, sort: (p) => p.__cat.label },
    { key: 'url', label: 'Page', render: (p) => `${p.money ? '<span class="pill warn" title="Money page">💰 money</span> ' : ''}<span class="url" style="display:inline-block;vertical-align:middle">${esc(shortUrl(p.url))}</span>`, text: (p) => (p.money ? 'money ' : '') + p.url, sort: (p) => (p.money ? 'a' : 'b') + p.url },
    { key: 'onpage_score', label: 'On-page', num: 1, render: (p) => `<span class="pill ${pillFor(p.onpage_score)}">${p.onpage_score}</span>` },
    { key: 'content_score', label: 'Content', num: 1, render: (p) => `<span class="pill ${pillFor(p.content_score)}">${p.content_score}</span>` },
    { key: 'c', label: 'Clicks', num: 1, render: (p) => fmt(p.gsc?.c), sort: (p) => p.gsc?.c || 0 },
    { key: 'i', label: 'Impr.', num: 1, render: (p) => fmt(p.gsc?.i), sort: (p) => p.gsc?.i || 0 },
    { key: 'pos', label: 'Pos', num: 1, render: (p) => fmt(p.gsc?.p, 1), sort: (p) => p.gsc?.p || 999 },
    { key: 'sessions', label: 'Org. sessions', num: 1, render: (p) => fmt(p.ga?.sessions), sort: (p) => p.ga?.sessions || 0 },
    { key: 'issues', label: 'Issues', num: 1, render: (p) => p.checks.filter((c) => c.val < 1).length, sort: (p) => p.checks.filter((c) => c.val < 1).length },
  ], pages, { onRow: (p) => pageDetail(p, run), limit: 1000 }))}<p class="hint">Click a page for the full audit and query coverage. Type <b>money</b> in the filter to see only money pages.</p></div>`;
}

function pageDetail(p, run) {
  const m = p.meta || {};
  const rec = (run.ai?.page_recommendations || []).find((r) => r.url === p.url);
  const cats = {};
  for (const c of p.checks) (cats[c.cat] ||= []).push(c);
  openDrawer(`${p.money ? '<span class="pill warn">💰 Money page</span>' : ''}<h2 style="word-break:break-all"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></h2>
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
    ${geoSection(p)}
    <div class="card section"><h3>On-page audit</h3>${Object.entries(cats).map(([cat, cs]) => `<div class="muted small" style="margin-top:10px;font-weight:600">${cat}</div>${cs.map((c) => `<div class="check"><span class="dot ${c.val >= 1 ? 'good' : c.val > 0 ? 'warn' : 'bad'}">${c.val >= 1 ? '✓' : c.val > 0 ? '!' : '✗'}</span><div><div>${esc(c.label)}</div>${c.detail ? `<div class="small muted" style="word-break:break-word">${esc(c.detail)}</div>` : ''}</div></div>`).join('')}`).join('')}</div>`);
}

function queriesTable(rows) {
  return table([
    { key: 'q', label: 'Query' },
    { key: 'c', label: 'Clicks', num: 1, render: (r) => `${fmt(r.c)} ${delta(r.c, r.prevC)}` },
    { key: 'i', label: 'Impressions', num: 1, render: (r) => fmt(r.i) },
    { key: 'ctr', label: 'CTR', num: 1, render: (r) => pct(r.ctr) },
    { key: 'p', label: 'Position', num: 1, render: (r) => `${r.p}${r.prevP ? ` <span class="muted small">(${r.prevP})</span>` : ''}` },
  ], rows, { limit: 1000 });
}

function viewQueries(gsc, run) {
  const prev = Object.fromEntries(gsc.prevQueries.map((q) => [q.q, q]));
  const full = run.summary?.full;
  setTimeout(() => {
    const box = document.getElementById('q-box');
    document.querySelectorAll('[data-blob]').forEach((b) => (b.onclick = async () => {
      const kind = b.dataset.blob;
      b.disabled = true; b.textContent = 'Loading…';
      try {
        const rows = await loadBlob(run.id, kind);
        if (b.dataset.csv) {
          const head = kind === 'pagequeries' ? ['page', 'query'] : [kind === 'pages' ? 'page' : 'query'];
          const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
          const csv = [[...head, 'clicks', 'impressions', 'ctr', 'position'].join(','), ...rows.map((r) => r.map(q).join(','))].join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          a.download = `${kind}-${run.start_date}-${run.end_date}.csv`;
          a.click();
        } else {
          box.innerHTML = queriesTable(rows.map(([q, c, i, ctr, p]) => ({ q, c, i, ctr, p, prevC: prev[q]?.c ?? null, prevP: prev[q]?.p ?? null })));
        }
        b.textContent = '✓ Done';
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Retry'; }
    }));
  });
  const rows = gsc.queries.map((q) => ({ ...q, prevC: prev[q.q]?.c ?? null, prevP: prev[q.q]?.p ?? null }));
  return `<div class="card">${full ? `<div class="row" style="margin-bottom:12px"><span class="pill info">Full export saved</span>
      <button class="btn sm primary" data-blob="queries">Show all ${fmt(full.queries)} queries</button>
      <button class="btn sm" data-blob="queries" data-csv="1">⬇ Queries CSV</button>
      <button class="btn sm" data-blob="pages" data-csv="1">⬇ Pages CSV (${fmt(full.pages)})</button>
      <button class="btn sm" data-blob="pagequeries" data-csv="1">⬇ Page × query CSV (${fmt(full.pagequeries)})</button></div>` : ''}
    <div id="q-box">${table([
    { key: 'q', label: 'Query' },
    { key: 'c', label: 'Clicks', num: 1, render: (r) => `${fmt(r.c)} ${delta(r.c, r.prevC)}` },
    { key: 'i', label: 'Impressions', num: 1, render: (r) => fmt(r.i) },
    { key: 'ctr', label: 'CTR', num: 1, render: (r) => pct(r.ctr) },
    { key: 'p', label: 'Position', num: 1, render: (r) => `${r.p}${r.prevP ? ` <span class="muted small">(${r.prevP})</span>` : ''}` },
  ], rows, { limit: 1000 })}</div></div>`;
}

function viewTechnical(site, pages) {
  const actions = `<div class="card"><h2>🛠️ Technical & on-page action items</h2><p class="muted small">Sorted by impact = check importance × share of impressions on failing pages (money pages weigh extra). Owner tells you who fixes it.</p>${actionsTable(checkActions(pages), pages)}</div>`;
  return actions + '<div class="section"></div>' + viewTechnicalBase(site, pages);
}
function viewTechnicalBase(site, pages) {
  const dup = (title, arr) => arr.length ? `<div class="card section"><h3>${title}</h3>${arr.map(([v, urls]) => `<div class="check"><div><b>${esc(v)}</b><div class="small">${urls.map((u) => pageLink(u, pages)).join(' · ')}</div></div></div>`).join('')}</div>` : '';
  const issueCount = {};
  for (const p of pages) for (const c of p.checks) if (c.val < 1) (issueCount[c.label] ||= []).push(p.url);
  const issues = Object.entries(issueCount).sort((a, b) => b[1].length - a[1].length);
  return `<div class="grid g2"><div class="card"><h2>Site checks</h2>${site.checks.map((c) => `<div class="check"><span class="dot ${c.val >= 1 ? 'good' : c.val > 0 ? 'warn' : 'bad'}">${c.val >= 1 ? '✓' : c.val > 0 ? '!' : '✗'}</span><div><div>${esc(c.label)}</div><div class="small muted">${esc(c.detail)}</div></div></div>`).join('')}</div>
    <div class="card"><h2>Most common page issues</h2>${issues.map(([label, urls]) => `<div class="check"><span class="pill ${urls.length > pages.length / 2 ? 'bad' : 'warn'}">${urls.length}/${pages.length}</span><div>${esc(label)}</div></div>`).join('') || '<p class="muted">No issues found 🎉</p>'}</div></div>
    ${dup('Duplicate titles', site.duplicates.titles)}${dup('Duplicate meta descriptions', site.duplicates.descriptions)}`;
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
