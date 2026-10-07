import { normalizeVideo, buildReports, fmtNum, keywords } from './analysis.js';

const $ = (id) => document.getElementById(id);
const MAX_COMPS = 10;
const store = {
  get(k, d) { try { const v = localStorage.getItem('sv:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sv:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let state = { reports: [], channels: [], videos: [], active: 'dashboard', ai: {} };

// ── Theme ────────────────────────────────────────────────────
const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; };
applyTheme(store.get('theme'));
$('themeBtn').onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next); store.set('theme', next);
};

// ── Settings / keys ──────────────────────────────────────────
let server = { youtube: false, gemini: false, openModels: false };
fetch('/api/health').then((r) => r.json()).then((h) => {
  server = h;
  $('serverKeys').textContent = `Server: YouTube key ${h.youtube ? '✓' : '✗'} · Open-source models (Workers AI) ${h.openModels ? '✓' : '✗'} · Gemini key ${h.gemini ? '✓' : '✗'}`;
  if (!h.youtube && !store.get('ytKey')) $('quotaNote').textContent = 'Add a YouTube API key in Settings first.';
}).catch(() => {});
$('settingsBtn').onclick = () => { $('ytKey').value = store.get('ytKey', ''); $('gemKey').value = store.get('gemKey', ''); $('settings').showModal(); };
$('saveKeys').onclick = () => { store.set('ytKey', $('ytKey').value.trim()); store.set('gemKey', $('gemKey').value.trim()); $('quotaNote').textContent = ''; };
function keyHeaders() {
  const h = {};
  if (store.get('ytKey')) h['x-yt-key'] = store.get('ytKey');
  if (store.get('gemKey')) h['x-gemini-key'] = store.get('gemKey');
  return h;
}
async function api(path, body) {
  const r = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json', ...keyHeaders() }, body: JSON.stringify(body) }
    : { headers: keyHeaders() });
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ── Setup form ───────────────────────────────────────────────
function addCompRow(value = '') {
  const list = $('compList');
  if (list.children.length >= MAX_COMPS) return;
  const row = document.createElement('div');
  row.className = 'comp-row';
  row.innerHTML = `<input placeholder="Competitor channel URL or @handle"><button class="btn ghost small" title="Remove">✕</button>`;
  row.querySelector('input').value = value;
  row.querySelector('button').onclick = () => { row.remove(); updateCount(); };
  list.appendChild(row);
  updateCount();
}
function updateCount() {
  const n = $('compList').children.length;
  $('compCount').textContent = `${n} / ${MAX_COMPS}`;
  $('addComp').disabled = n >= MAX_COMPS;
}
$('addComp').onclick = () => addCompRow();

const saved = store.get('config', {});
$('brand').value = saved.brand || '';
$('market').value = saved.market || '';
$('ownChannel').value = saved.own || '';
$('maxVideos').value = saved.max || '200';
(saved.comps?.length ? saved.comps : ['', '']).forEach(addCompRow);

$('runBtn').onclick = runAudit;

async function runAudit() {
  const cfg = {
    brand: $('brand').value.trim(),
    market: $('market').value.trim(),
    own: $('ownChannel').value.trim(),
    comps: [...$('compList').querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean),
    max: $('maxVideos').value,
  };
  if (!cfg.own && !cfg.comps.length) { alert('Add at least one channel.'); return; }
  store.set('config', cfg);

  const jobs = [...(cfg.own ? [{ q: cfg.own, type: 'Own' }] : []), ...cfg.comps.map((q) => ({ q, type: 'Competitor' }))];
  const prog = $('progress');
  prog.hidden = false;
  prog.innerHTML = '';
  $('runBtn').disabled = true;
  const started = performance.now();

  const channels = [], videos = [];
  const now = Date.now();
  const seen = new Set();
  // One channel per request: keeps each Worker call small and shows progress.
  for (const job of jobs) {
    const line = document.createElement('div');
    line.textContent = `⏳ ${job.q}`;
    prog.appendChild(line);
    try {
      const fresh = $('fresh').checked ? '&fresh=1' : '';
      const d = await api(`/api/channel?q=${encodeURIComponent(job.q)}&max=${cfg.max}${fresh}`);
      if (seen.has(d.channel.id)) { line.textContent = `↷ ${d.channel.title}: already added`; continue; }
      seen.add(d.channel.id);
      const ch = { ...d.channel, type: job.type, input: job.q };
      channels.push(ch);
      for (const v of d.videos) videos.push(normalizeVideo(v, ch, now));
      line.className = 'ok';
      line.textContent = `✓ ${ch.title}: ${d.videos.length} videos`;
    } catch (e) {
      line.className = 'err';
      line.textContent = `✗ ${job.q}: ${e.message}`;
    }
  }
  $('runBtn').disabled = false;
  if (!channels.length) return;

  const secs = ((performance.now() - started) / 1000).toFixed(1);
  state = { ...state, cfg, channels, videos, reports: buildReports(channels, videos, now), active: 'dashboard', ai: {} };
  $('resTitle').textContent = (cfg.brand || channels[0].title) + ' audit';
  $('resMeta').textContent = `${channels.length} channels · ${videos.length} videos · ${secs}s · ${new Date().toLocaleString()}${cfg.market ? ' · ' + cfg.market : ''}`;
  $('results').hidden = false;
  render();
  $('results').scrollIntoView({ behavior: 'smooth' });
}

// ── Rendering ────────────────────────────────────────────────
const GOOD = new Set(['Strong', 'Yes', 'Already Optimised', 'Top Performer', 'Above Average']);
const WARN = new Set(['Average', 'Medium']);
const BAD = new Set(['Weak', 'No', 'Needs Update', 'Low Performer', 'High']);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cell(v, fmt) {
  switch (fmt) {
    case 'num': return typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : esc(v);
    case 'pct': return typeof v === 'number' ? (v * 100).toFixed(2) + '%' : esc(v);
    case 'url': return v ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace('https://', ''))}</a>` : '';
    case 'thumb': return v ? `<img loading="lazy" src="${esc(v)}" alt="">` : '';
    case 'status': {
      const cls = GOOD.has(v) ? 'good' : WARN.has(v) ? 'warn' : BAD.has(v) ? 'bad' : '';
      return `<span class="pill ${cls}">${esc(v)}</span>`;
    }
    default: return esc(v);
  }
}

function render() {
  const dash = state.reports.find((r) => r.id === 'dashboard');
  $('kpis').innerHTML = (dash.kpis || []).map(([k, v, h]) => `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${h ? `<div class="h">${esc(h)}</div>` : ''}</div>`).join('');

  const tabs = [...state.reports.map((r) => [r.id, r.title]), ['ai', 'AI Review']];
  $('tabs').innerHTML = tabs.map(([id, t]) => `<button class="tab" role="tab" data-id="${id}" aria-selected="${id === state.active}">${esc(t)}</button>`).join('');
  $('tabs').querySelectorAll('.tab').forEach((b) => { b.onclick = () => { state.active = b.dataset.id; render(); }; });

  const panel = $('panel');
  panel.innerHTML = '';
  if (state.active === 'ai') return renderAi(panel);
  const rep = state.reports.find((r) => r.id === state.active);
  if (rep.gallery) panel.appendChild(renderGallery(rep.sections[0]));
  else rep.sections.forEach((s) => panel.appendChild(renderSection(s)));
}

function renderSection(sec) {
  const el = document.createElement('div');
  el.className = 'section';
  el.innerHTML = `<div class="section-head"><h3>${esc(sec.title)} <span class="muted small">(${sec.rows.length})</span></h3>
    <div class="actions" style="margin:0"><input placeholder="Filter…"><button class="btn ghost small">CSV</button></div></div>
    ${sec.note ? `<p class="note">${esc(sec.note)}</p>` : ''}<div class="table-wrap"></div>`;
  let rows = sec.rows, sortCol = -1, asc = true, filter = '';
  const wrap = el.querySelector('.table-wrap');
  const draw = () => {
    let r = filter ? rows.filter((row) => row.some((c) => String(c).toLowerCase().includes(filter))) : rows;
    if (sortCol >= 0) r = [...r].sort((a, b) => {
      const x = a[sortCol], y = b[sortCol];
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return asc ? d : -d;
    });
    if (!r.length) { wrap.innerHTML = '<div class="empty">No rows.</div>'; return; }
    const shown = r.slice(0, 1000);
    wrap.innerHTML = `<table><thead><tr>${sec.columns.map(([l, f], i) => `<th class="${f === 'num' || f === 'pct' ? 'num' : ''}" data-i="${i}">${esc(l)}${i === sortCol ? (asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((row) => `<tr>${row.map((v, i) => { const f = sec.columns[i][1]; return `<td class="${f === 'num' || f === 'pct' ? 'num' : f === 'thumb' ? 'thumb' : ''}">${cell(v, f)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    wrap.querySelectorAll('th').forEach((th) => { th.onclick = () => { const i = +th.dataset.i; asc = sortCol === i ? !asc : false; sortCol = i; draw(); }; });
  };
  el.querySelector('input').oninput = (e) => { filter = e.target.value.toLowerCase(); draw(); };
  el.querySelector('button').onclick = () => download(slug(sec.title) + '.csv', toCsv(sec), 'text/csv');
  draw();
  return el;
}

function renderGallery(sec) {
  const el = document.createElement('div');
  el.className = 'section';
  el.innerHTML = `<div class="section-head"><h3>${esc(sec.title)}</h3><div class="actions" style="margin:0">
    <select id="galFilter" style="width:auto;margin:0"><option value="">All channels</option>${state.channels.map((c) => `<option>${esc(c.title)}</option>`).join('')}</select>
    <button class="btn ghost small">CSV</button></div></div><p class="note">${esc(sec.note || '')}</p><div class="gallery"></div>`;
  const grid = el.querySelector('.gallery');
  const draw = (ch) => {
    const rows = sec.rows.filter((r) => !ch || r[1] === ch).slice(0, 300);
    grid.innerHTML = rows.map((r) => {
      const ai = state.ai[r[3]]?.thumb;
      return `<div class="tcard"><a href="${esc(r[3])}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(r[0])}" alt=""></a>
      <div class="body"><div class="title">${esc(r[2])}</div><div class="muted">${esc(r[1])} · ${fmtNum(r[5])} views · ${(r[6] * 100).toFixed(2)}% eng.</div>
      <div style="margin-top:6px">${cell(r[7], 'status')} ${r[8] === 'No' ? '<span class="pill bad">No HD thumb</span>' : ''}</div>
      ${ai ? thumbAiHtml(ai) : ''}</div></div>`;
    }).join('');
  };
  el.querySelector('select').onchange = (e) => draw(e.target.value);
  el.querySelector('button').onclick = () => download('thumbnails.csv', toCsv(sec), 'text/csv');
  draw('');
  return el;
}

// ── AI review ────────────────────────────────────────────────
// Default: open-source models on Cloudflare Workers AI (Llama 3.3 text,
// Llama 3.2 Vision thumbnails, FLUX.1 schnell images). Gemini is optional.
// Real photos come from Openverse (openly licensed, with attribution).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let provider = store.get('provider', 'open');

function whyBars(title, parts, total) {
  return `<div class="ai-box"><b>${esc(title)}</b> <span class="num" style="float:right;font-weight:700">${total}/100</span><div class="why">${parts.map(([label, pts, max, note]) =>
    `<div class="why-row" title="${esc(note)}"><span>${esc(label)}</span><div class="bar"><i style="width:${max ? (pts / max) * 100 : 0}%"></i></div><span class="pts">${pts}/${max}</span></div>`).join('')}</div>
    <div class="muted small" style="margin-top:6px">Hover a row for the reason. Rules are in "How Scores Work".</div></div>`;
}
function thumbAiHtml(a) {
  return `<div class="ai"><b>AI thumbnail score: ${esc(a.score)}</b> · contrast ${esc(a.contrast)} · clutter ${esc(a.clutter)}${a.face_or_emotion ? ' · face ✓' : ''}
    ${a.why ? `<div class="muted">${esc(a.why)}</div>` : ''}<ul>${(a.fixes || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
}

function aiCardHtml(v) {
  const a = state.ai[v.url] || {};
  const rw = a.rewrite, th = a.thumb;
  const label = provider === 'gemini' ? 'Gemini' : 'Llama (open-source)';
  return `<div class="ai-card" data-url="${esc(v.url)}">
    <div class="ai-grid">
      <div><a href="${esc(v.url)}" target="_blank" rel="noopener"><img src="${esc(v.thumb)}" alt="" style="width:100%;border-radius:10px;box-shadow:0 8px 18px -8px rgba(0,0,0,.5)"></a>
        <div style="font-weight:600;margin-top:8px">${esc(v.title)}</div>
        <div class="muted small">${esc(v.channel)} · <span class="num">${fmtNum(v.views)}</span> views · ${esc(v.perfTier)}</div>
        <div class="actions" style="margin-top:10px">
          <button class="btn primary small" data-act="review">${rw ? 'Re-run' : 'Review'} with ${label}</button>
          <button class="btn small" data-act="image">Generate thumbnail</button>
          <button class="btn small" data-act="photos">Find real photos</button>
        </div>
        ${a.busy ? `<div class="muted small" style="margin-top:6px">⏳ ${esc(a.busy)}</div>` : ''}
        ${a.error ? `<div class="err small" style="margin-top:6px">${esc(a.error)}</div>` : ''}
      </div>
      <div>
        <div class="ai-cols">
          ${whyBars('SEO score', v.seoParts, v.seoScore)}
          ${whyBars('CTA score', v.cta.parts, v.cta.score)}
          ${whyBars('Performance score', v.perfParts, v.perfScore)}
          <div class="ai-box"><b>Thumbnail review</b>${th ? `<div class="ai-score">${esc(th.score)}<span class="muted small">/100</span></div>
            <div class="small">${esc(th.why || '')}</div><div class="small muted">Contrast ${esc(th.contrast)} · Clutter ${esc(th.clutter)} · Text readable ${th.text_readable == null ? 'n/a' : th.text_readable ? '✓' : '✗'} · Face ${th.face_or_emotion ? '✓' : '✗'}</div>
            <ul>${(th.fixes || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : `<div class="muted small" style="margin-top:6px">Run a review to score the thumbnail as it looks on a phone.</div>`}</div>
        </div>
        ${rw ? `<div class="ai-cols">
          <div class="ai-box"><b>Better titles</b><ul>${(rw.titles || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul><div class="muted small">${esc(rw.title_why || '')}</div></div>
          <div class="ai-box"><b>CTA</b><div class="small" style="margin-top:4px">${esc(rw.cta_review)}</div><div style="margin-top:6px"><b>Suggested</b><div>${esc(rw.cta)}</div></div>
            <div style="margin-top:6px"><b>New opening lines</b><div>${esc(rw.description_intro)}</div></div><div style="margin-top:6px"><b>Hashtags</b> ${esc((rw.hashtags || []).join(' '))}</div></div>
        </div>` : ''}
        ${a.image ? `<div class="ai-cols"><div><div class="concept"><img src="${a.image}" alt="AI thumbnail concept"><span>${esc(rw?.thumbnail_text || '')}</span></div>
          <div class="actions" style="margin-top:8px"><button class="btn small" data-act="download">Download PNG</button><span class="muted small">FLUX.1 [schnell], Apache-2.0: free to use</span></div></div>
          <div class="ai-box"><b>Image prompt</b><div class="small">${esc(rw?.thumbnail_prompt || '')}</div></div></div>` : ''}
        ${a.photos ? `<div style="margin-top:12px"><b class="small muted">REAL PHOTOS (Openverse, openly licensed: credit the creator)</b>
          <div class="gallery" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-top:8px">${a.photos.length ? a.photos.map((p) => `<a class="tcard" href="${esc(p.page)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(p.thumb)}" alt="${esc(p.title)}"><div class="body small">${esc(p.creator || 'Unknown')} · ${esc(p.license)}</div></a>`).join('') : '<div class="muted small">No openly licensed photos found.</div>'}</div></div>` : ''}
      </div>
    </div></div>`;
}

function renderAi(panel) {
  const own = state.videos.filter((v) => v.channelType === 'Own');
  const pool = own.length ? own : state.videos;
  const picks = {
    'Top 10 by views': [...pool].sort((a, b) => b.views - a.views).slice(0, 10),
    'Bottom 10 by performance': [...pool].filter((v) => v.ageDays > 14).sort((a, b) => a.perfScore - b.perfScore).slice(0, 10),
  };
  let current = state.aiPick || 'Top 10 by views';
  panel.innerHTML = `<div class="section">
    <div class="section-head"><h3>AI review</h3>
      <div class="seg" role="group" aria-label="AI provider">
        <button data-p="open" aria-pressed="${provider === 'open'}">Open-source (Llama · FLUX)</button>
        <button data-p="gemini" aria-pressed="${provider === 'gemini'}">Gemini</button>
      </div></div>
    <p class="note">Each card shows why the video scored what it did, then optional AI help: better titles and CTA, a thumbnail score, a new thumbnail image, and real openly licensed photos.
      Open-source models run free on Cloudflare Workers AI${server.openModels ? '' : ' (not available on this server yet; see README)'}. Gemini needs a key${server.gemini || store.get('gemKey') ? '' : ' (none set)'}.</p>
    <div class="actions" style="margin:0 0 14px">${Object.keys(picks).map((k) => `<button class="btn small ${k === current ? 'primary' : ''}" data-k="${esc(k)}">${esc(k)}</button>`).join('')}
      <button class="btn small" id="aiAll">Review all 10</button><span class="muted small" id="aiStatus"></span></div>
    <div id="aiList"></div></div>`;
  const list = panel.querySelector('#aiList');
  const vids = () => picks[current];
  const draw = () => { list.innerHTML = vids().map(aiCardHtml).join(''); };
  const redrawCard = (v) => { const el = list.querySelector(`[data-url="${CSS.escape(v.url)}"]`); if (el) el.outerHTML = aiCardHtml(v); };
  draw();

  panel.querySelectorAll('.seg button').forEach((b) => { b.onclick = () => { provider = b.dataset.p; store.set('provider', provider); renderAi(panel); }; });
  panel.querySelectorAll('button[data-k]').forEach((b) => { b.onclick = () => { state.aiPick = b.dataset.k; renderAi(panel); }; });

  async function run(v, act) {
    const a = (state.ai[v.url] = state.ai[v.url] || {});
    const step = async (msg, fn) => { a.busy = msg; redrawCard(v); await fn(); };
    try {
      delete a.error;
      if (act === 'review') {
        await step('Rewriting title and CTA…', async () => { a.rewrite = await api('/api/ai/rewrite', { title: v.title, description: v.descRaw, market: state.cfg.market, provider }); });
        if (provider === 'gemini') await sleep(4000);
        await step('Reviewing thumbnail…', async () => { a.thumb = await api('/api/ai/thumbnail', { url: v.thumb, title: v.title, provider }); });
      } else if (act === 'image') {
        if (!a.rewrite) await step('Writing the thumbnail idea…', async () => { a.rewrite = await api('/api/ai/rewrite', { title: v.title, description: v.descRaw, market: state.cfg.market, provider }); });
        await step('Generating image with FLUX…', async () => { a.image = (await api('/api/ai/image', { prompt: a.rewrite.thumbnail_prompt || v.title })).image; });
      } else if (act === 'photos') {
        const q = [...keywords(v.title)].slice(0, 3).join(' ') || v.title;
        await step('Searching Openverse…', async () => { a.photos = (await api(`/api/photos?q=${encodeURIComponent(q)}`)).results; });
      } else if (act === 'download') {
        return downloadConcept(a.image, a.rewrite?.thumbnail_text || '', v.id);
      }
    } catch (e) {
      a.error = e.message;
    }
    delete a.busy;
    redrawCard(v);
  }

  list.onclick = (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const v = vids().find((x) => x.url === btn.closest('.ai-card').dataset.url);
    if (v) run(v, btn.dataset.act);
  };
  panel.querySelector('#aiAll').onclick = async (e) => {
    e.target.disabled = true;
    const status = panel.querySelector('#aiStatus');
    for (const [i, v] of vids().entries()) {
      if (state.ai[v.url]?.thumb) continue;
      status.textContent = `Reviewing ${i + 1} / ${vids().length}…`;
      await run(v, 'review');
      if (/429|quota|rate/i.test(state.ai[v.url]?.error || '')) { status.textContent = 'Hit the free-tier limit. Wait a minute and run again; finished videos are kept.'; e.target.disabled = false; return; }
      await sleep(provider === 'gemini' ? 4500 : 500);
    }
    status.textContent = 'Done.';
    e.target.disabled = false;
  };
}

// Burn the headline into the generated image so it can be uploaded as-is.
function downloadConcept(src, text, id) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 1280, 720);
    if (text) {
      g.font = '800 92px "Space Grotesk", Inter, sans-serif';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      const words = text.toUpperCase().split(/\s+/);
      const lines = [];
      for (const w of words) { const last = lines[lines.length - 1]; if (last && g.measureText(last + ' ' + w).width < 680) lines[lines.length - 1] = last + ' ' + w; else lines.push(w); }
      lines.forEach((l, i) => {
        const y = 360 + (i - (lines.length - 1) / 2) * 100;
        g.lineWidth = 14; g.strokeStyle = '#000'; g.strokeText(l, 70, y);
        g.fillStyle = '#fff'; g.fillText(l, 70, y);
      });
    }
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `thumbnail-${id}.png`;
    a.click();
  };
  img.src = src;
}

// ── Export ───────────────────────────────────────────────────
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function toCsv(sec) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [sec.columns.map(([l]) => l), ...sec.rows].map((r) => r.map(q).join(',')).join('\n');
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('exportAll').onclick = () => {
  const parts = state.reports.flatMap((r) => r.sections.map((s) => `### ${r.title} — ${s.title}\n${toCsv(s)}`));
  download('searchverse-audit.csv', parts.join('\n\n'), 'text/csv');
};
$('exportJson').onclick = () => {
  const { cfg, channels, videos, ai } = state;
  download('searchverse-audit.json', JSON.stringify({ cfg, channels, videos: videos.map(({ descRaw, ...v }) => v), ai }, null, 2), 'application/json');
};
$('printBtn').onclick = () => window.print();
