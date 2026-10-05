import { normalizeRows, analyze, analyzeQueries } from './analyze.js';
import { parseCsv } from './csv.js';
import { fetchGsc, fetchSheet, listSites } from './gsc.js';
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

async function loadRows(body, env) {
  const range = body.week ? weekRange(body.week) : null;
  if (body.source === 'gsc') {
    if (!env.GSC_SERVICE_ACCOUNT) throw new Error('Connect Search Console in Settings first.');
    if (!range) throw new Error('Pick a week.');
    return fetchGsc(env, body.site || env.GSC_SITE_URL, range);
  }
  let raw;
  if (body.source === 'sheet') {
    // Private sheet via service account, or a "Publish to web" CSV link.
    if (body.sheetId) raw = await fetchSheet(env, body.sheetId, body.range);
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

async function callGemini(env, system, content, maxOutputTokens) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
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
  if (data.error) throw new Error('Gemini: ' + data.error.message);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned no text (' + (data.candidates?.[0]?.finishReason || 'unknown') + ')');
  return text;
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
    const authed = !env.ACCESS_TOKEN || cookie(request, 'seo_pass') === env.ACCESS_TOKEN;

    if (url.pathname === '/login' && request.method === 'POST') {
      const pass = (await request.formData()).get('pass');
      if (pass !== env.ACCESS_TOKEN) return html(LOGIN.replace('<!--err-->', '<p class="err">Wrong passcode</p>'), 401);
      return new Response(null, { status: 303, headers: {
        location: '/',
        'set-cookie': `seo_pass=${encodeURIComponent(pass)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
      } });
    }
    if (!authed) return url.pathname.startsWith('/api/') ? json({ error: 'Unauthorized' }, 401) : html(LOGIN);

    // Keys saved on the Settings page arrive with each request and override Worker secrets.
    let body = {};
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      body = await request.json().catch(() => ({}));
      env = { ...env };
      if (body.keys?.gemini) env.GEMINI_API_KEY = body.keys.gemini;
      if (body.keys?.gsc) env.GSC_SERVICE_ACCOUNT = body.keys.gsc;
      delete body.keys;
    }

    if (url.pathname === '/api/sites' && request.method === 'POST') {
      if (!env.GSC_SERVICE_ACCOUNT) return json({ error: 'Upload the Search Console key file in Settings first.' }, 400);
      try {
        return json({ sites: await listSites(env), email: JSON.parse(env.GSC_SERVICE_ACCOUNT).client_email });
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
