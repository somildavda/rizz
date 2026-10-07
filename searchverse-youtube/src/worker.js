// Searchverse API: a thin Cloudflare Worker.
// - Proxies the YouTube Data API so the key stays server-side (one channel per
//   request, which keeps each call well under the free plan's 50 subrequests).
// - Optional AI review with two providers:
//     open   = open-source models on Cloudflare Workers AI (Llama 3.3 for text,
//              Llama 3.2 Vision for thumbnails, FLUX.1 schnell for images). No key.
//     gemini = Google Gemini free tier (needs GEMINI_API_KEY).
// - Real CC-licensed photos for thumbnail ideas via Openverse.
// All scoring runs in the browser (public/analysis.js).

import {
  authConfigured, authStart, authCallback, logout, currentUser, tokenFor, connectionStatus, disconnect,
  listUsers, addUser, updateUser, removeUser, sendInvite,
} from './auth.js';

import { keywords } from '../public/analysis.js';

const YT = 'https://www.googleapis.com/youtube/v3/';
const CACHE_TTL = 6 * 3600;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/auth/login') return await authStart(req, env, 'login');
      if (url.pathname === '/auth/youtube') return await authStart(req, env, 'youtube');
      if (url.pathname === '/auth/mail') return await authStart(req, env, 'mail');
      if (url.pathname === '/auth/callback') return await authCallback(req, env);
      if (url.pathname === '/auth/logout' && req.method === 'POST') return await logout(req, env);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);

      const key = `${req.method} ${url.pathname}`;
      if (key === 'GET /api/health') return health(env);
      // Everything else needs a signed-in user (Sign in with Google). For local
      // testing without Google set up, put OPEN_ACCESS=1 in .dev.vars.
      let user = await currentUser(req, env);
      if (!user && env.OPEN_ACCESS === '1' && !authConfigured(env)) user = { email: 'local@dev', name: 'Local', role: 'admin', local: true };
      if (key === 'GET /api/session') return await session(env, user);
      if (!user) return json({ error: 'Please sign in.' }, 401);
      const route = ROUTES[key];
      if (!route) return json({ error: 'Not found' }, 404);
      if (ADMIN_ONLY.has(key) && user.role !== 'admin') return json({ error: 'Only admins can do this.' }, 403);
      return await route(req, env, ctx, url, user);
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status || 500);
    }
  },
};

const health = (env) => json({ ok: true, youtube: !!env.YT_API_KEY, gemini: !!env.GEMINI_API_KEY, openModels: !!env.AI, signIn: authConfigured(env) });

async function session(env, user) {
  if (!user) return json({ signedIn: false, signInReady: authConfigured(env) });
  const local = user.local;
  return json({
    signedIn: true,
    user,
    youtube: local ? null : await connectionStatus(env, 'yt_connections', user.email),
    mailbox: local || user.role !== 'admin' ? null : await connectionStatus(env, 'mail_senders', user.email),
    brevo: !!(env.BREVO_API_KEY && env.MAIL_FROM),
  });
}

const ADMIN_ONLY = new Set(['GET /api/users', 'POST /api/users', 'PATCH /api/users', 'DELETE /api/users', 'POST /api/invite', 'POST /api/mail/disconnect']);

const ROUTES = {
  'GET /api/channel': getChannel,
  'GET /api/suggest-competitors': suggestCompetitors,
  'GET /api/me': me,
  'GET /api/me/analytics': myAnalytics,
  'POST /api/youtube/disconnect': async (req, env, ctx, url, user) => { await disconnect(env, 'yt_connections', user.email); return json({ ok: true }); },
  'POST /api/mail/disconnect': async (req, env, ctx, url, user) => { await disconnect(env, 'mail_senders', user.email); return json({ ok: true }); },
  'GET /api/users': async (req, env) => json({ users: await listUsers(env) }),
  'POST /api/users': async (req, env, ctx, url, user) => {
    const { email, role, invite = true } = await req.json();
    const added = await addUser(env, user.email, email, role);
    const sent = invite ? await sendInvite(env, url.origin, added, user.email, role) : null;
    return json({ ok: true, email: added, invite: sent });
  },
  'PATCH /api/users': async (req, env, ctx, url, user) => { const b = await req.json(); await updateUser(env, user.email, b.email, b); return json({ ok: true }); },
  'DELETE /api/users': async (req, env, ctx, url, user) => { await removeUser(env, user.email, url.searchParams.get('email')); return json({ ok: true }); },
  'POST /api/invite': async (req, env, ctx, url, user) => {
    const { email } = await req.json();
    const u = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
    if (!u) fail('User not found.', 404);
    return json({ ok: true, email, invite: await sendInvite(env, url.origin, email, user.email, u.role) });
  },
  'POST /api/ai/classify': aiClassify,
  'POST /api/ai/rewrite': aiRewrite,
  'POST /api/ai/thumbnail': aiThumbnail,
  'POST /api/ai/image': aiImage,
  'GET /api/photos': photos,
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}

// Server secret first; a key typed into the UI (sent as a header) is the fallback
// for local testing or for people running the tool without deploying secrets.
const ytKey = (req, env) => env.YT_API_KEY || req.headers.get('x-yt-key') || fail('YouTube API key missing. Set the YT_API_KEY secret or add a key in Settings.', 401);
const geminiKey = (req, env) => env.GEMINI_API_KEY || req.headers.get('x-gemini-key') || fail('Gemini API key missing. Set the GEMINI_API_KEY secret or add a key in Settings.', 401);

// ── YouTube ──────────────────────────────────────────────────
async function yt(path, params, key) {
  const u = new URL(YT + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // `key` is an API key, or "Bearer <token>" when the user signed in with Google.
  const headers = {};
  if (key.startsWith('Bearer ')) headers.authorization = key;
  else u.searchParams.set('key', key);
  const r = await fetch(u, { headers });
  const body = await r.json();
  if (!r.ok) fail(`YouTube API ${r.status}: ${body.error?.message || 'error'}`, r.status === 403 ? 429 : 502);
  return body;
}

function parseChannelInput(input) {
  input = input.trim();
  let m;
  if ((m = input.match(/(?:^|\/)(UC[0-9A-Za-z_-]{22})/))) return { id: m[1] };
  if ((m = input.match(/@([^/?\s]+)/))) return { handle: decodeURIComponent(m[1]) };
  if ((m = input.match(/\/(?:c|user)\/([^/?\s]+)/))) return { legacy: decodeURIComponent(m[1]) };
  if ((m = input.match(/(?:youtu\.be\/|v=|shorts\/)([A-Za-z0-9_-]{11})/))) return { video: m[1] };
  if (/^[\w.-]+$/.test(input)) return { handle: input };
  return null;
}

async function resolveChannel(input, key) {
  const p = parseChannelInput(input);
  if (!p) fail(`Can't read "${input}". Use a channel URL, @handle, or any video URL from the channel.`);
  const part = 'snippet,statistics,contentDetails';
  let res;
  if (p.id) res = await yt('channels', { part, id: p.id }, key);
  else if (p.handle) res = await yt('channels', { part, forHandle: '@' + p.handle }, key);
  else if (p.legacy) {
    // /user/ names still resolve cheaply; /c/ custom URLs need search (100 units).
    res = await yt('channels', { part, forUsername: p.legacy }, key);
    if (!res.items?.length) {
      const s = await yt('search', { part: 'snippet', type: 'channel', q: p.legacy, maxResults: '1' }, key);
      const id = s.items?.[0]?.snippet?.channelId;
      if (id) res = await yt('channels', { part, id }, key);
    }
  } else if (p.video) {
    const v = await yt('videos', { part: 'snippet', id: p.video }, key);
    const id = v.items?.[0]?.snippet?.channelId;
    if (id) res = await yt('channels', { part, id }, key);
  }
  const it = res?.items?.[0];
  if (!it) fail(`Channel not found: ${input}`, 404);
  return {
    id: it.id,
    title: it.snippet.title,
    handle: it.snippet.customUrl || '',
    thumb: it.snippet.thumbnails?.default?.url || '',
    country: it.snippet.country || '',
    subscribers: +it.statistics.subscriberCount || 0,
    hiddenSubscribers: !!it.statistics.hiddenSubscriberCount,
    totalViews: +it.statistics.viewCount || 0,
    videoCount: +it.statistics.videoCount || 0,
    uploads: it.contentDetails.relatedPlaylists.uploads,
  };
}

async function ytAuth(req, env, user) {
  const key = env.YT_API_KEY || req.headers.get('x-yt-key');
  if (key) return key;
  const t = user && !user.local ? await tokenFor(env, 'yt_connections', user.email) : null;
  return t ? 'Bearer ' + t.token : ytKey(req, env);
}

// Auto competitor list: take the channel's best-performing topics, search
// YouTube for them, and rank the other channels that keep appearing.
// Cost: ~4 searches × 100 units + a few 1-unit calls (of 10,000/day free).
async function suggestCompetitors(req, env, ctx, url, user) {
  const q = url.searchParams.get('q') || fail('Add your channel first.');
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.searchverse/suggest?q=${encodeURIComponent(q.toLowerCase())}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const key = await ytAuth(req, env, user);
  const channel = await resolveChannel(q, key);
  const pl = await yt('playlistItems', { part: 'contentDetails', maxResults: '50', playlistId: channel.uploads }, key);
  const ids = (pl.items || []).map((it) => it.contentDetails.videoId);
  if (!ids.length) fail('This channel has no public videos to learn topics from.', 404);
  const vids = (await yt('videos', { part: 'snippet,statistics', id: ids.join(',') }, key)).items || [];
  vids.sort((a, b) => (+b.statistics.viewCount || 0) - (+a.statistics.viewCount || 0));

  // Queries: the top 3 videos' main keywords, plus the channel's most common keywords.
  const freq = new Map();
  for (const v of vids) for (const w of keywords(v.snippet.title)) freq.set(w, (freq.get(w) || 0) + 1);
  const common = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w).join(' ');
  const queries = [...new Set([...vids.slice(0, 3).map((v) => [...keywords(v.snippet.title)].slice(0, 4).join(' ')), common].filter(Boolean))].slice(0, 4);

  const region = /^[A-Z]{2}$/.test(channel.country) ? channel.country : '';
  const tally = new Map();
  for (const query of queries) {
    const params = { part: 'snippet', type: 'video', maxResults: '25', q: query };
    if (region) params.regionCode = region;
    const res = await yt('search', params, key);
    for (const it of res.items || []) {
      const id = it.snippet.channelId;
      if (id === channel.id) continue;
      const t = tally.get(id) || { id, title: it.snippet.channelTitle, hits: 0, queries: new Set() };
      t.hits++;
      t.queries.add(query);
      tally.set(id, t);
    }
  }
  const top = [...tally.values()].sort((a, b) => b.queries.size - a.queries.size || b.hits - a.hits).slice(0, 12);
  const details = top.length ? (await yt('channels', { part: 'snippet,statistics', id: top.map((t) => t.id).join(',') }, key)).items || [] : [];
  const byId = new Map(details.map((d) => [d.id, d]));
  const suggestions = top.map((t) => {
    const d = byId.get(t.id);
    return {
      id: t.id, title: d?.snippet?.title || t.title, handle: d?.snippet?.customUrl || '', thumb: d?.snippet?.thumbnails?.default?.url || '',
      subscribers: +d?.statistics?.subscriberCount || 0, videoCount: +d?.statistics?.videoCount || 0,
      hits: t.hits, matched: [...t.queries],
    };
  });
  const res = json({ channel: { id: channel.id, title: channel.title }, queries, suggestions }, 200, { 'cache-control': 'public, max-age=86400' });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function getChannel(req, env, ctx, url, user) {
  const q = url.searchParams.get('q') || fail('Missing ?q=');
  const max = Math.min(500, Math.max(1, +url.searchParams.get('max') || 200));

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.searchverse/channel?q=${encodeURIComponent(q.toLowerCase())}&max=${max}`);
  const hit = await cache.match(cacheKey);
  if (hit && url.searchParams.get('fresh') !== '1') return hit;

  const key = await ytAuth(req, env, user);
  const channel = await resolveChannel(q, key);

  const ids = [];
  let token = '';
  while (ids.length < max) {
    const params = { part: 'contentDetails', maxResults: '50', playlistId: channel.uploads };
    if (token) params.pageToken = token;
    const d = await yt('playlistItems', params, key);
    for (const it of d.items || []) ids.push(it.contentDetails.videoId);
    token = d.nextPageToken;
    if (!token) break;
  }

  const videos = [];
  const wanted = ids.slice(0, max);
  for (let i = 0; i < wanted.length; i += 50) {
    const d = await yt('videos', { part: 'snippet,statistics,contentDetails', id: wanted.slice(i, i + 50).join(',') }, key);
    for (const v of d.items || []) {
      // Keep only what the analysis needs to keep responses small.
      videos.push({
        id: v.id,
        snippet: { title: v.snippet.title, description: v.snippet.description, publishedAt: v.snippet.publishedAt, tags: v.snippet.tags, thumbnails: v.snippet.thumbnails },
        statistics: v.statistics,
        contentDetails: { duration: v.contentDetails.duration },
      });
    }
  }

  const res = json({ channel, videos, fetchedAt: new Date().toISOString() }, 200, { 'cache-control': `public, max-age=${CACHE_TTL}` });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// ── AI providers ─────────────────────────────────────────────
const MODELS = {
  text: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  vision: '@cf/meta/llama-3.2-11b-vision-instruct',
  image: '@cf/black-forest-labs/flux-1-schnell',
};

function pickProvider(req, env, asked) {
  const hasGemini = !!(env.GEMINI_API_KEY || req.headers.get('x-gemini-key'));
  // Open-source models are the default; Gemini only when chosen (or when Workers AI is unavailable).
  const p = asked === 'gemini' || asked === 'open' ? asked : env.AI ? 'open' : hasGemini ? 'gemini' : 'open';
  if (p === 'open' && !env.AI) fail('Open-source models need the Workers AI binding ([ai] in wrangler.toml) and a Cloudflare login.', 501);
  return p;
}

// Ask a model for JSON. `image` (optional) is { bytes: Uint8Array, mime }.
async function askJson(req, env, provider, prompt, { image, temperature = 0.2 } = {}) {
  let text;
  if (provider === 'gemini') {
    const parts = image ? [{ inline_data: { mime_type: image.mime, data: toBase64(image.bytes) } }, { text: prompt }] : [{ text: prompt }];
    text = await gemini(req, env, parts, temperature);
  } else if (image) {
    text = await runVision(env, prompt, image.bytes);
  } else {
    const out = await env.AI.run(MODELS.text, {
      messages: [{ role: 'system', content: 'You reply with a single valid JSON object and nothing else.' }, { role: 'user', content: prompt }],
      max_tokens: 900,
      temperature,
    });
    text = out.response;
  }
  return parseJson(text);
}

async function runVision(env, prompt, bytes) {
  const input = { messages: [{ role: 'user', content: prompt + '\nReply with a single JSON object only.' }], image: [...bytes], max_tokens: 600 };
  try {
    return (await env.AI.run(MODELS.vision, input)).response;
  } catch (e) {
    // Meta's licence must be accepted once per account before first use.
    if (!/agree/i.test(e.message)) throw e;
    await env.AI.run(MODELS.vision, { prompt: 'agree' });
    return (await env.AI.run(MODELS.vision, input)).response;
  }
}

async function gemini(req, env, parts, temperature) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey(req, env) },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature, responseMimeType: 'application/json' } }),
  });
  const data = await r.json();
  if (!r.ok) fail(`Gemini ${r.status}: ${data.error?.message || 'error'}`, r.status === 429 ? 429 : 502);
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

function parseJson(text) {
  if (text && typeof text === 'object') return text;
  const t = String(text || '');
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  try { return JSON.parse(t.slice(start, end + 1)); } catch { fail('AI returned invalid JSON. Try again.', 502); }
}

async function aiClassify(req, env) {
  const { title, description = '', type = '', provider } = await req.json();
  const prompt = `You are a YouTube content analyst. Classify this video. Return JSON only.
Title: ${title}
Description (first 400 chars): ${description.slice(0, 400)}
Video type: ${type}
JSON keys: "theme" (short topic label), "format" (one of: Podcast, Interview, Comparison, How To, Listicle, Review, Testimonial, Case Study, Webinar, Product Demo, Explainer, News / Update, Opinion, Behind The Scenes, Shorts, Other), "intent" (one of: Awareness, Educational, Consideration, Comparison, Decision, Proof / Case Study), "audience" (5 words max), "funnel" (Top, Middle or Bottom), "opportunity" (0-100 number), "notes" (one plain-language observation, under 20 words).`;
  const p = pickProvider(req, env, provider);
  return json({ ...(await askJson(req, env, p, prompt, { temperature: 0.1 })), provider: p });
}

async function aiRewrite(req, env) {
  const { title, description = '', market = '', provider } = await req.json();
  const prompt = `You are a YouTube SEO strategist${market ? ' for the ' + market + ' market' : ''}. Improve this video's metadata. Return JSON only.
Title: ${title}
Description: ${description.slice(0, 1500)}
JSON keys:
"titles": array of 3 alternative titles, 40-70 chars, keyword first,
"title_why": one sentence on why these titles should get more clicks or search traffic,
"cta_review": one sentence on the current CTA: is it clear, specific and early?,
"cta": a rewritten CTA for the first 2 lines of the description,
"description_intro": a rewritten first 150 characters,
"hashtags": array of 3 hashtags,
"thumbnail_text": 2-4 punchy words to print on the thumbnail,
"thumbnail_prompt": an image-generation prompt for a new thumbnail background: one clear subject, bold colours, high contrast, space on the left for text, no words or letters in the image.`;
  const p = pickProvider(req, env, provider);
  return json({ ...(await askJson(req, env, p, prompt, { temperature: 0.5 })), provider: p });
}

async function aiThumbnail(req, env) {
  const { url, title = '', provider } = await req.json();
  if (!/^https:\/\/i\d?\.ytimg\.com\//.test(url || '')) fail('Only YouTube thumbnail URLs are allowed.');
  // A smaller rendition keeps the vision request light; fall back to the given URL.
  const img = await fetch(url.replace(/(maxresdefault|sddefault)\.jpg/, 'hqdefault.jpg')).then((r) => (r.ok ? r : fetch(url)));
  if (!img.ok) fail('Could not load thumbnail', 502);
  const bytes = new Uint8Array(await img.arrayBuffer());
  const prompt = `You are a YouTube thumbnail expert. Review this thumbnail for the video "${title}" as it appears on a phone (small size). Return JSON only with keys:
"score" (0-100), "text_readable" (true/false/null if no text), "face_or_emotion" (true/false), "contrast" (Low/Medium/High), "clutter" (Low/Medium/High), "matches_title" (true/false), "why" (one sentence explaining the score), "fixes" (array of 2 short, specific fixes).`;
  const p = pickProvider(req, env, provider);
  return json({ ...(await askJson(req, env, p, prompt, { image: { bytes, mime: img.headers.get('content-type') || 'image/jpeg' }, temperature: 0.1 })), provider: p });
}

// Thumbnail concept image from an open-source model (FLUX.1 schnell, Apache-2.0),
// so generated images can be used freely.
async function aiImage(req, env) {
  const { prompt } = await req.json();
  if (!prompt) fail('Missing prompt');
  if (!env.AI) fail('Image generation needs the Workers AI binding ([ai] in wrangler.toml).', 501);
  const out = await env.AI.run(MODELS.image, { prompt: `YouTube thumbnail, 16:9, ${prompt}, no text, no letters, no watermark`.slice(0, 2000), steps: 6 });
  return json({ image: 'data:image/jpeg;base64,' + out.image, model: 'FLUX.1 [schnell] (Apache-2.0)' });
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Real, openly licensed photos for thumbnail ideas from Openverse
// (open source: github.com/WordPress/openverse). No key needed; each result
// carries its licence and attribution, filtered to licences allowing commercial use.
async function photos(req, env, ctx, url) {
  const q = (url.searchParams.get('q') || '').slice(0, 120) || fail('Missing ?q=');
  const u = new URL('https://api.openverse.org/v1/images/');
  u.searchParams.set('q', q);
  u.searchParams.set('license_type', 'commercial,modification');
  u.searchParams.set('aspect_ratio', 'wide');
  u.searchParams.set('page_size', '8');
  const r = await fetch(u, { headers: { 'user-agent': 'searchverse-youtube' } });
  if (!r.ok) fail(`Openverse ${r.status}`, 502);
  const d = await r.json();
  return json({
    results: (d.results || []).map((x) => ({
      thumb: x.thumbnail, url: x.url, page: x.foreign_landing_url, title: x.title,
      creator: x.creator, license: `CC ${String(x.license).toUpperCase()} ${x.license_version || ''}`.trim(), licenseUrl: x.license_url, attribution: x.attribution,
    })),
  }, 200, { 'cache-control': 'public, max-age=86400' });
}

// ── Connected channel (owner data) ───────────────────────────
async function ytToken(env, user) {
  const t = user.local ? null : await tokenFor(env, 'yt_connections', user.email);
  if (!t) fail('YouTube is not connected (or the 7-day Google testing access expired). Click "Connect YouTube".', 401);
  return t;
}

async function me(req, env, ctx, url, user) {
  const t = user.local ? null : await tokenFor(env, 'yt_connections', user.email);
  if (!t) return json({ connected: false, channels: [] });
  const d = await yt('channels', { part: 'snippet,statistics', mine: 'true', maxResults: '50' }, 'Bearer ' + t.token);
  const channels = (d.items || []).map((it) => ({
    id: it.id, title: it.snippet.title, handle: it.snippet.customUrl || '', thumb: it.snippet.thumbnails?.default?.url || '',
    subscribers: +it.statistics.subscriberCount || 0, videoCount: +it.statistics.videoCount || 0,
  }));
  return json({ connected: true, googleEmail: t.googleEmail, channels });
}

// YouTube Analytics API: watch time, retention, subscribers, traffic sources,
// YouTube search terms and countries for a channel the user owns.
async function myAnalytics(req, env, ctx, url, user) {
  const s = await ytToken(env, user);
  const channel = url.searchParams.get('channel') || 'MINE';
  const days = Math.min(365, Math.max(7, +url.searchParams.get('days') || 90));
  const end = new Date(Date.now() - 2 * 86400000); // analytics lag ~2 days
  const start = new Date(end.getTime() - days * 86400000);
  const base = { ids: channel === 'MINE' ? 'channel==MINE' : 'channel==' + channel, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
  const q = async (params) => {
    const u = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    for (const [k, v] of Object.entries({ ...base, ...params })) u.searchParams.set(k, v);
    const r = await fetch(u, { headers: { authorization: 'Bearer ' + s.token } });
    const d = await r.json();
    if (!r.ok) fail(`YouTube Analytics ${r.status}: ${d.error?.message || 'error'}`, r.status === 403 ? 403 : 502);
    const cols = (d.columnHeaders || []).map((c) => c.name);
    return (d.rows || []).map((row) => Object.fromEntries(row.map((v, i) => [cols[i], v])));
  };
  const [totals, daily, videos, traffic, searchTerms, countries] = await Promise.all([
    q({ metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares' }),
    q({ dimensions: 'day', metrics: 'views,estimatedMinutesWatched,subscribersGained', sort: 'day' }),
    q({ dimensions: 'video', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained', sort: '-views', maxResults: '200' }),
    q({ dimensions: 'insightTrafficSourceType', metrics: 'views,estimatedMinutesWatched', sort: '-views' }),
    q({ dimensions: 'insightTrafficSourceDetail', filters: 'insightTrafficSourceType==YT_SEARCH', metrics: 'views', sort: '-views', maxResults: '25' }),
    q({ dimensions: 'country', metrics: 'views,estimatedMinutesWatched', sort: '-views', maxResults: '15' }),
  ]);
  return json({ range: { start: base.startDate, end: base.endDate, days }, totals: totals[0] || {}, daily, videos, traffic, searchTerms, countries });
}
