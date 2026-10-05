import { normalizeRows, analyze } from './analyze.js';
import { parseCsv } from './csv.js';
import { fetchGsc, fetchSheet } from './gsc.js';
import { SYSTEM_PROMPT, userPrompt } from './prompt.js';
import { HTML, LOGIN } from './ui.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html;charset=utf-8' } });

function cookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function loadRows(body, env) {
  if (body.source === 'gsc') {
    if (!env.GSC_SERVICE_ACCOUNT) throw new Error('GSC_SERVICE_ACCOUNT secret is not set.');
    return fetchGsc(env, body.site || env.GSC_SITE_URL, body.days || 28);
  }
  if (body.source === 'sheet') {
    // Private sheet via service account, or a "Publish to web" CSV link.
    if (body.sheetId) return fetchSheet(env, body.sheetId, body.range);
    const res = await fetch(body.csvUrl);
    if (!res.ok) throw new Error('Could not fetch sheet CSV (is it published to the web?)');
    return parseCsv(await res.text());
  }
  return parseCsv(body.csv || '');
}

async function writeSummary(findings, ctx, env) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-opus-5-5',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(findings, ctx) }],
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
    if (url.pathname === '/') return new Response(HTML, { headers: { 'content-type': 'text/html;charset=utf-8' } });

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      try {
        const body = await request.json();
        const rows = normalizeRows(await loadRows(body, env));
        if (!rows.length) return json({ error: 'No rows found.' }, 400);
        const findings = analyze(rows);
        const summary = env.ANTHROPIC_API_KEY && body.writeSummary !== false
          ? await writeSummary(findings, body, env)
          : null;
        return json({ findings, summary });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }
    return new Response('Not found', { status: 404 });
  },
};
