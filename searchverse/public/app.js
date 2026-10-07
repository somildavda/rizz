import { normalizeVideo, buildReports, fmtNum } from './analysis.js';

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
let server = { youtube: false, gemini: false };
fetch('/api/health').then((r) => r.json()).then((h) => {
  server = h;
  $('serverKeys').textContent = `Server keys: YouTube ${h.youtube ? '✓ set' : '✗ not set'} · Gemini ${h.gemini ? '✓ set' : '✗ not set'}`;
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
  $('kpis').innerHTML = (dash.kpis || []).map(([k, v]) => `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');

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

// ── AI review (optional; Gemini free tier) ───────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function thumbAiHtml(a) {
  return `<div class="ai"><b>AI thumbnail score: ${esc(a.score)}</b> · contrast ${esc(a.contrast)} · clutter ${esc(a.clutter)}${a.face_or_emotion ? ' · face ✓' : ''}
    <ul>${(a.fixes || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
}

function renderAi(panel) {
  const own = state.videos.filter((v) => v.channelType === 'Own');
  const pool = own.length ? own : state.videos;
  const picks = {
    'Top 10 by views': [...pool].sort((a, b) => b.views - a.views).slice(0, 10),
    'Bottom 10 by performance': [...pool].filter((v) => v.ageDays > 14).sort((a, b) => a.perfScore - b.perfScore).slice(0, 10),
  };
  panel.innerHTML = `<div class="section"><p class="note">Uses the Gemini free tier, which allows only a few requests per minute, so videos are reviewed one at a time with a short pause between them.
    ${server.gemini || store.get('gemKey') ? '' : '<b>Add a Gemini API key in Settings to use this tab.</b>'}</p>
    <div class="actions" style="margin:0 0 12px">${Object.keys(picks).map((k) => `<button class="btn primary small" data-k="${esc(k)}">Review ${esc(k.toLowerCase())}</button>`).join('')}
    <span class="muted small" id="aiStatus"></span></div><div id="aiList"></div></div>`;
  const list = panel.querySelector('#aiList');
  const drawList = (vids) => {
    list.innerHTML = vids.map((v) => {
      const a = state.ai[v.url] || {};
      const rw = a.rewrite;
      return `<div class="ai-card" style="display:grid;grid-template-columns:160px 1fr;gap:12px">
        <img src="${esc(v.thumb)}" alt="" style="width:160px;border-radius:8px">
        <div><div style="font-weight:600">${esc(v.title)}</div>
        <div class="muted small">${esc(v.channel)} · ${fmtNum(v.views)} views · SEO ${v.seoScore} · CTA ${v.cta.score}</div>
        ${a.error ? `<div class="err small">${esc(a.error)}</div>` : ''}
        ${rw ? `<div class="small" style="margin-top:8px"><b>Title ideas</b><ul>${(rw.titles || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          <b>CTA review:</b> ${esc(rw.cta_review)}<br><b>Suggested CTA:</b> ${esc(rw.cta)}<br><b>New opening:</b> ${esc(rw.description_intro)}<br><b>Hashtags:</b> ${esc((rw.hashtags || []).join(' '))}</div>` : ''}
        ${a.thumb ? thumbAiHtml(a.thumb) : ''}</div></div>`;
    }).join('');
  };
  drawList(picks['Top 10 by views']);
  panel.querySelectorAll('button[data-k]').forEach((b) => {
    b.onclick = async () => {
      const vids = picks[b.dataset.k];
      drawList(vids);
      panel.querySelectorAll('button[data-k]').forEach((x) => (x.disabled = true));
      const status = panel.querySelector('#aiStatus');
      for (const [i, v] of vids.entries()) {
        if (state.ai[v.url]?.rewrite && state.ai[v.url]?.thumb) continue;
        status.textContent = `Reviewing ${i + 1} / ${vids.length}…`;
        const entry = (state.ai[v.url] = state.ai[v.url] || {});
        try {
          entry.rewrite = await api('/api/ai/rewrite', { title: v.title, description: v.descRaw, market: state.cfg.market });
          await sleep(4500);
          entry.thumb = await api('/api/ai/thumbnail', { url: v.thumb, title: v.title });
          delete entry.error;
        } catch (e) {
          entry.error = e.message;
          if (/429|quota|rate/i.test(e.message)) { status.textContent = 'Hit the free-tier rate limit. Wait a minute and run again; finished videos are kept.'; break; }
        }
        drawList(vids);
        await sleep(4500);
      }
      if (!/rate limit/.test(status.textContent)) status.textContent = 'Done.';
      panel.querySelectorAll('button[data-k]').forEach((x) => (x.disabled = false));
    };
  });
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
