// Searchverse API: a thin Cloudflare Worker.
// - Proxies the YouTube Data API so the key stays server-side (one channel per
//   request, which keeps each call well under the free plan's 50 subrequests).
// - Wraps the Gemini free tier for optional AI review (titles, CTA, thumbnails).
// All scoring runs in the browser (public/analysis.js).

const YT = 'https://www.googleapis.com/youtube/v3/';
const CACHE_TTL = 6 * 3600;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) return json({ error: 'Not found' }, 404);
      return await route(req, env, ctx, url);
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status || 500);
    }
  },
};

const ROUTES = {
  'GET /api/health': async (req, env) => json({ ok: true, youtube: !!env.YT_API_KEY, gemini: !!env.GEMINI_API_KEY }),
  'GET /api/channel': getChannel,
  'POST /api/ai/classify': aiClassify,
  'POST /api/ai/rewrite': aiRewrite,
  'POST /api/ai/thumbnail': aiThumbnail,
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
  u.searchParams.set('key', key);
  const r = await fetch(u);
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

async function getChannel(req, env, ctx, url) {
  const q = url.searchParams.get('q') || fail('Missing ?q=');
  const max = Math.min(500, Math.max(1, +url.searchParams.get('max') || 200));

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.searchverse/channel?q=${encodeURIComponent(q.toLowerCase())}&max=${max}`);
  const hit = await cache.match(cacheKey);
  if (hit && url.searchParams.get('fresh') !== '1') return hit;

  const key = ytKey(req, env);
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

// ── Gemini ───────────────────────────────────────────────────
async function gemini(req, env, { parts, temperature = 0.2 }) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, responseMimeType: 'application/json' },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey(req, env) },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) fail(`Gemini ${r.status}: ${data.error?.message || 'error'}`, r.status === 429 ? 429 : 502);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  return { text, cand };
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch { fail('AI returned invalid JSON. Try again.', 502); }
}

async function aiClassify(req, env) {
  const { title, description = '', type = '' } = await req.json();
  const prompt = `You are a YouTube content analyst. Classify this video. Return JSON only.
Title: ${title}
Description (first 400 chars): ${description.slice(0, 400)}
Video type: ${type}
JSON keys: "theme" (short topic label), "format" (one of: Podcast, Interview, Comparison, How To, Listicle, Review, Testimonial, Case Study, Webinar, Product Demo, Explainer, News / Update, Opinion, Behind The Scenes, Shorts, Other), "intent" (one of: Awareness, Educational, Consideration, Comparison, Decision, Proof / Case Study), "audience" (5 words max), "funnel" (Top, Middle or Bottom), "opportunity" (0-100 number), "notes" (one plain-language observation, under 20 words).`;
  const { text } = await gemini(req, env, { parts: [{ text: prompt }], temperature: 0.1 });
  return json(parseJson(text));
}

async function aiRewrite(req, env) {
  const { title, description = '', market = '' } = await req.json();
  const prompt = `You are a YouTube SEO strategist${market ? ' for the ' + market + ' market' : ''}. Improve this video's metadata. Return JSON only.
Title: ${title}
Description: ${description.slice(0, 1500)}
JSON keys: "titles" (array of 3 alternative titles, 40-70 chars, keyword first), "cta_review" (one sentence on the current CTA: is it clear, specific, early?), "cta" (a rewritten CTA for the first 2 lines of the description), "description_intro" (a rewritten first 150 characters), "hashtags" (array of 3 hashtags).`;
  const { text } = await gemini(req, env, { parts: [{ text: prompt }], temperature: 0.5 });
  return json(parseJson(text));
}

async function aiThumbnail(req, env) {
  const { url, title = '' } = await req.json();
  if (!/^https:\/\/i\d?\.ytimg\.com\//.test(url || '')) fail('Only YouTube thumbnail URLs are allowed.');
  const img = await fetch(url);
  if (!img.ok) fail('Could not load thumbnail', 502);
  const b64 = toBase64(await img.arrayBuffer());
  const prompt = `You are a YouTube thumbnail expert. Review this thumbnail for the video "${title}". Judge it as it appears on a phone (small size). Return JSON only with keys:
"score" (0-100), "text_readable" (true/false/null if no text), "face_or_emotion" (true/false), "contrast" (Low/Medium/High), "clutter" (Low/Medium/High), "matches_title" (true/false), "fixes" (array of 2 short, specific fixes).`;
  const { text } = await gemini(req, env, {
    parts: [{ inline_data: { mime_type: img.headers.get('content-type') || 'image/jpeg', data: b64 } }, { text: prompt }],
    temperature: 0.1,
  });
  return json(parseJson(text));
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
