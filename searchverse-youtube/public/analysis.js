// Searchverse analysis engine.
// Port of the "Search Indicators" Apps Script rules (classification, SEO and
// performance scoring, all 14 report sheets) into plain functions over JSON.
// Runs in the browser and in Node (tests), so the Worker only proxies YouTube.

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const LENGTH_BUCKETS = ['0–30 sec', '31–60 sec', '1–3 min', '3–5 min', '5–8 min', '8–12 min', '12–20 min', '20+ min'];
export const INTENT_ORDER = ['Awareness', 'Educational', 'Consideration', 'Comparison', 'Decision', 'Proof / Case Study'];

// ── Classification ───────────────────────────────────────────
export function classifyTheme(title, desc, type) {
  if (type === 'Shorts') return 'Shorts';
  const x = (title + ' ' + desc).toLowerCase();
  if (/\bgeo\b|generative engine|ai overview|ai search|search generative|llm search|answer engine|\baeo\b/.test(x)) return 'GEO / AI Search';
  if (/\bseo\b|search engine optimi[sz]|\brank(ing)?\b|serp|backlink|keyword research|on.?page|off.?page/.test(x)) return 'SEO';
  if (/\bai\b|artificial intelligence|machine learning|chatgpt|openai|gemini|claude|\bllm\b|large language/.test(x)) return 'AI';
  if (/\bppc\b|pay.per.click|google ads|paid search|paid media|ad campaign|display ads|performance max/.test(x)) return 'PPC';
  if (/\bcro\b|conversion rate|landing page|a\/b test|split test|ab test/.test(x)) return 'CRO';
  if (/analytics|\bga4\b|data studio|looker|reporting|tracking|attribution/.test(x)) return 'Analytics';
  if (/content marketing|content strategy|content plan|editorial|\bblog\b|content calendar/.test(x)) return 'Content Marketing';
  if (/social media|instagram|tiktok|linkedin|twitter|facebook|meta ads/.test(x)) return 'Social Media';
  if (/ecommerce|e-commerce|shopify|woocommerce|product page|online store|amazon|marketplace/.test(x)) return 'Ecommerce';
  if (/\bbranding\b|brand identity|brand strategy|brand voice|\blogo\b|positioning/.test(x)) return 'Branding';
  if (/lead gen|inbound|outbound|prospecting|sales funnel|pipeline/.test(x)) return 'Lead Generation';
  if (/email marketing|newsletter|drip campaign|klaviyo|mailchimp/.test(x)) return 'Email Marketing';
  if (/webinar|live stream|podcast/.test(x)) return 'Podcast / Webinar';
  return 'Other';
}

export function classifyFormat(title, desc, type) {
  if (type === 'Shorts') return 'Shorts';
  const x = (title + ' ' + desc).toLowerCase();
  if (/podcast|episode \d|\bep\s*\d|hosted by/.test(x)) return 'Podcast';
  if (/interview|sit down with|talking to|spoke with|chat with/.test(x)) return 'Interview';
  if (/\bvs\b|versus|compare|comparison|which is better|head to head/.test(x)) return 'Comparison';
  if (/how to|step by step|tutorial|walkthrough|beginners? guide/.test(x)) return 'How To';
  if (/\d+\s*(tip|reason|way|mistake|tool|thing|example|hack|idea|strateg|step)/.test(x)) return 'Listicle';
  if (/review|my verdict|tested|testing|we tried/.test(x)) return 'Review';
  if (/testimonial|client story|what our client|customer success/.test(x)) return 'Testimonial';
  if (/case study|real result|how we|how i |how they|grew from|went from/.test(x)) return 'Case Study';
  if (/webinar|live training|workshop/.test(x)) return 'Webinar';
  if (/\bdemo\b|product tour|platform overview|software walkthrough/.test(x)) return 'Product Demo';
  if (/explainer|explained|what is|what are|definition|overview|introduction to/.test(x)) return 'Explainer';
  if (/\bnews\b|update|breaking|announced|revealed/.test(x)) return 'News / Update';
  if (/my opinion|i think|unpopular opinion|hot take|controversial|\brant\b/.test(x)) return 'Opinion';
  if (/behind the scenes|day in the life|\bvlog\b|office tour/.test(x)) return 'Behind The Scenes';
  return 'Other';
}

export function classifyIntent(title, desc) {
  const x = (title + ' ' + desc).toLowerCase();
  if (/\bbuy\b|pricing|book a demo|\bhire\b|get started|sign up|free trial|schedule a/.test(x)) return 'Decision';
  if (/\bbest\b|\btop \d|review|compare|\bvs\b|versus|which.*better|alternative/.test(x)) return 'Comparison';
  if (/case study|real result|success story|\bproof\b/.test(x)) return 'Proof / Case Study';
  if (/solution|\btools?\b|platform|software|\bfix\b|solve/.test(x)) return 'Consideration';
  if (/how to|tutorial|guide|learn|step|walkthrough|beginner|explained|tips/.test(x)) return 'Educational';
  return 'Awareness';
}

export function lengthBucket(sec) {
  if (sec <= 30) return LENGTH_BUCKETS[0];
  if (sec <= 60) return LENGTH_BUCKETS[1];
  if (sec <= 180) return LENGTH_BUCKETS[2];
  if (sec <= 300) return LENGTH_BUCKETS[3];
  if (sec <= 480) return LENGTH_BUCKETS[4];
  if (sec <= 720) return LENGTH_BUCKETS[5];
  if (sec <= 1200) return LENGTH_BUCKETS[6];
  return LENGTH_BUCKETS[7];
}

// ── Scoring ──────────────────────────────────────────────────
const KEYWORD_SIGNAL = /how to|guide|best|tutorial|review|\bvs\b|20\d\d|\d+/i;

// Every score is a sum of named parts so the UI can explain it ("why").
// part = [label, points earned, max points, explanation]
export function seoParts(title, desc, hashtagCount, tagsText) {
  const tl = title.length, dl = desc.length;
  return [
    ['Title length', tl >= 40 && tl <= 75 ? 25 : tl >= 30 ? 12 : 0, 25, `${tl} chars (best 40–75: long enough for a keyword and a hook, short enough not to be cut off)`],
    ['Description', dl >= 180 ? 25 : dl >= 100 ? 12 : 0, 25, `${dl} chars without hashtags (best 180+: gives YouTube and Google text to index)`],
    ['Hashtags', hashtagCount >= 2 && hashtagCount <= 8 ? 20 : hashtagCount >= 1 ? 10 : 0, 20, `${hashtagCount} (best 2–8; YouTube ignores all hashtags when there are more than 15)`],
    ['Tags', tagsText.length > 30 ? 15 : tagsText.length > 0 ? 8 : 0, 15, tagsText.length ? `${tagsText.length} chars of tags` : 'No tags'],
    ['Keyword signal', KEYWORD_SIGNAL.test(title) ? 15 : 0, 15, 'Title has a search pattern: how to, guide, best, review, vs, a year or a number'],
  ];
}
export const sumParts = (parts) => Math.min(100, parts.reduce((a, p) => a + p[1], 0));
export const explainParts = (parts) => parts.map((p) => `${p[0]} ${p[1]}/${p[2]}`).join(' · ');
export function scoreSEO(title, desc, hashtagCount, tagsText) {
  return sumParts(seoParts(title, desc, hashtagCount, tagsText));
}

export function perfParts(views, vpd, er) {
  return [
    ['Reach', Math.min(72, Math.round(Math.log10(Math.max(1, views)) * 12)), 72, `${fmtNum(views)} views, on a log scale: 12 points per ×10 (1K = 36, 100K = 60, 1M+ = 72)`],
    ['Momentum', Math.round(Math.min(40, vpd / 20)), 40, `${Math.round(vpd)} views/day since publishing (800+/day = full 40)`],
    ['Engagement', Math.round(Math.min(30, er * 400)), 30, `${(er * 100).toFixed(2)}% (likes + comments) ÷ views (7.5%+ = full 30)`],
  ];
}
export function scorePerformance(views, vpd, er) {
  return sumParts(perfParts(views, vpd, er));
}

export function performanceTier(s) {
  if (s >= 80) return 'Top Performer';
  if (s >= 60) return 'Above Average';
  if (s >= 35) return 'Average';
  return 'Low Performer';
}

export const titleStatus = (t) => (t.length >= 40 && t.length <= 75 ? 'Strong' : t.length >= 30 ? 'Average' : 'Weak');
export const descStatus = (d) => (d.length >= 180 ? 'Strong' : d.length >= 80 ? 'Average' : 'Weak');
export const hashtagStatus = (n) => (n >= 2 && n <= 8 ? 'Strong' : n === 1 || n === 9 ? 'Average' : 'Weak');
export function overallStatus(...s) {
  const strong = s.filter((x) => x === 'Strong').length;
  return strong === s.length ? 'Strong' : strong >= 1 ? 'Average' : 'Weak';
}

// CTA detection: which kinds of call to action a description contains, and
// whether one appears "above the fold" (first ~150 chars / 3 lines, visible
// without expanding the description).
const CTA_TYPES = {
  Subscribe: /subscribe|hit the bell|turn on notifications/i,
  Engage: /comment below|let us know|like this video|drop a comment|share this/i,
  Link: /click the link|link (in|below)|check out|visit|learn more|read more|https?:\/\//i,
  Lead: /book a|sign up|get in touch|contact us|free trial|download|register|whatsapp|call us/i,
  Shop: /\bshop\b|buy now|order now|use code|discount|coupon|\bsale\b/i,
  Follow: /follow us|instagram\.com|linkedin\.com|twitter\.com|x\.com\//i,
};

export function analyzeCta(desc) {
  const types = Object.keys(CTA_TYPES).filter((k) => CTA_TYPES[k].test(desc));
  const fold = desc.split('\n').slice(0, 3).join('\n').slice(0, 150);
  const aboveFold = Object.values(CTA_TYPES).some((re) => re.test(fold));
  const links = (desc.match(/https?:\/\/\S+/g) || []).length;
  const parts = [
    ['Has a CTA', types.length ? 40 : 0, 40, types.length ? 'Found: ' + types.join(', ') : 'No subscribe, link, lead, shop or follow prompt found'],
    ['Above the fold', aboveFold ? 30 : 0, 30, 'A CTA within the first 3 lines / 150 chars, visible before "...more"'],
    ['Has a link', links ? 15 : 0, 15, `${links} link(s) in the description`],
    ['Multiple CTA types', types.length >= 2 ? 15 : 0, 15, 'Combines two or more CTA types (e.g. subscribe + link)'],
  ];
  return { types, aboveFold, links, parts, score: sumParts(parts) };
}

// ── Utilities ────────────────────────────────────────────────
export function isoDurationToSeconds(iso) {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
export function formatSeconds(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}
const extractHashtags = (t) => [...new Set(String(t).match(/#[\p{L}\p{N}_]+/gu) || [])];
const stripHashtags = (t) => String(t).replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]+/g, ' ').trim();
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / DAY + 1) / 7);
}
const sum = (rows, k) => rows.reduce((a, r) => a + (+r[k] || 0), 0);
const avg = (rows, k) => (rows.length ? sum(rows, k) / rows.length : 0);
const er = (rows) => { const v = sum(rows, 'views'); return v ? (sum(rows, 'likes') + sum(rows, 'comments')) / v : 0; };
const round1 = (v) => Math.round((+v || 0) * 10) / 10;
const byViewsDesc = (a, b) => b.views - a.views;
export function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
export function fmtNum(n) {
  n = +n || 0;
  if (n >= 1e7) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function videosPerMonth(rows) {
  if (!rows.length) return 0;
  const t = rows.map((r) => r.ts);
  const months = Math.max(1, (Math.max(...t) - Math.min(...t)) / (DAY * 30));
  return rows.length / months;
}

// Topic similarity by title keywords (replaces the random "similarity" proxy
// in the Apps Script version).
const STOP = new Set('the a an and or of to in on for with your you how what why is are this that from by at it its my our we i vs be can do does will best new video 2024 2025 2026'.split(' '));
export function keywords(title) {
  return new Set(String(title).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export function hasChapters(desc) {
  const stamps = [...String(desc).matchAll(/(?:^|\n)\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})/g)].map((m) => m[1]);
  return stamps.length >= 3 && /^0?0:00$|^0:00:00$/.test(stamps[0]);
}

// ── Normalisation ────────────────────────────────────────────
// `v` is a YouTube API videos.list item, `ch` a channels.list summary.
export function normalizeVideo(v, ch, now = Date.now()) {
  const sn = v.snippet || {}, st = v.statistics || {}, cd = v.contentDetails || {};
  const title = sn.title || '';
  const descRaw = sn.description || '';
  const hashtags = extractHashtags(title + ' ' + descRaw);
  const desc = stripHashtags(descRaw);
  const pub = new Date(sn.publishedAt);
  const sec = isoDurationToSeconds(cd.duration);
  // Shorts can be up to 3 min since Oct 2024; the API has no Shorts flag, so
  // 61–180s counts as Shorts only when tagged #shorts.
  const isShort = sec > 0 && (sec <= 60 || (sec <= 180 && /#shorts?\b/i.test(title + ' ' + descRaw)));
  const type = isShort ? 'Shorts' : 'Long Form';
  const views = +st.viewCount || 0, likes = +st.likeCount || 0, comments = +st.commentCount || 0;
  const ageDays = Math.max(1, Math.floor((now - pub) / DAY));
  const eng = views ? (likes + comments) / views : 0;
  const vpd = views / ageDays;
  const thumbs = sn.thumbnails || {};
  const tags = sn.tags || [];
  const seoP = seoParts(title, desc, hashtags.length, tags.join(' '));
  const perfP = perfParts(views, vpd, eng);
  const seo = sumParts(seoP);
  const perf = sumParts(perfP);
  const cta = analyzeCta(descRaw);
  return {
    id: v.id,
    url: 'https://youtu.be/' + v.id,
    channel: ch.title,
    channelId: ch.id,
    channelType: ch.type,
    thumb: (thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default || {}).url || '',
    hasMaxresThumb: !!thumbs.maxres,
    title,
    desc,
    descRaw,
    hashtags,
    tags,
    published: pub.toISOString().slice(0, 10),
    ts: pub.getTime(),
    year: pub.getUTCFullYear(),
    month: MONTHS[pub.getUTCMonth()],
    monthKey: pub.toISOString().slice(0, 7),
    quarter: 'Q' + Math.ceil((pub.getUTCMonth() + 1) / 3),
    week: isoWeek(pub),
    day: DAYS[pub.getUTCDay()],
    durationSec: sec,
    duration: formatSeconds(sec),
    type,
    views, likes, comments,
    er: eng,
    vpd,
    ageDays,
    theme: classifyTheme(title, desc, type),
    format: classifyFormat(title, desc, type),
    intent: classifyIntent(title, desc),
    lengthBucket: lengthBucket(sec),
    seoScore: seo,
    seoParts: seoP,
    perfParts: perfP,
    perfScore: perf,
    perfTier: performanceTier(perf),
    cta,
    // YouTube's rule: at least 3 timestamps, the first one at 0:00.
    hasChapters: hasChapters(descRaw),
    titleLen: title.length,
    descLen: desc.length,
    hashCount: hashtags.length,
  };
}

// ── Recommendations (rule-based; AI rewrites are a separate step) ──
function titleRec(t) {
  t = t.trim();
  if (!t) return 'Add a keyword-led title under 70 characters with a clear benefit.';
  if (t.length > 75) return t.slice(0, 65).replace(/\s+\S*$/, '') + ' (Complete Guide)';
  if (!/how to|guide|best|\d+/i.test(t)) return t + ' — Complete Guide';
  return t;
}
function descRec(title, desc) {
  const topic = title.split(/[:|\-–]/)[0].trim();
  const body = `In this video, we cover ${topic} with practical examples and clear steps.\n\n⏱ Chapters\n0:00 Intro\n\n👉 Subscribe for more.`;
  return desc.length >= 80 ? desc.slice(0, 160) + '\n\n' + body : body;
}
function hashtagRec(title) {
  const words = [...keywords(title)].slice(0, 3);
  return words.map((w) => '#' + w.replace(/\s/g, '')).join(' ');
}

// ── Reports ──────────────────────────────────────────────────
// Each report: { id, title, sections: [{ title, columns, rows, note? }] }.
// Column specs: [label, format] where format ∈ text|num|pct|date|url|status|thumb.
const C = (label, fmt = 'text') => [label, fmt];

export function buildReports(channels, videos, now = Date.now()) {
  const own = videos.filter((v) => v.channelType === 'Own');
  const comps = videos.filter((v) => v.channelType === 'Competitor');
  const chNames = channels.map((c) => c.title);
  const perChannel = (fn) => channels.map((c) => fn(c, videos.filter((v) => v.channelId === c.id)));

  // Channel benchmark (with real subscriber counts and three rankings)
  const bench = perChannel((c, rows) => ({
    c, rows, tv: sum(rows, 'views'), avgV: avg(rows, 'views'), er: er(rows), vpm: videosPerMonth(rows),
    seo: avg(rows, 'seoScore'), perf: avg(rows, 'perfScore'), cta: avg(rows.map((r) => ({ s: r.cta.score })), 's'),
  }));
  const rank = (key) => {
    const sorted = [...bench].sort((a, b) => b[key] - a[key]);
    return (b) => sorted.indexOf(b) + 1;
  };
  const rPerf = rank('avgV'), rPub = rank('vpm'), rEng = rank('er');
  const authority = (b) => Math.round(Math.min(100, Math.log10(Math.max(1, b.c.subscribers)) * 8 + Math.min(30, b.er * 600) + Math.min(20, b.vpm * 3) + b.seo * 0.1));

  const ownCh = channels.find((c) => c.type === 'Own');
  const kpis = ownCh ? [
    ['Subscribers', fmtNum(ownCh.subscribers), 'Public subscriber count from YouTube'],
    ['Videos analysed', own.length, 'Latest uploads fetched for this audit'],
    ['Long form', own.filter((v) => v.type === 'Long Form').length, 'Videos longer than 60s (or 3 min without #shorts)'],
    ['Shorts', own.filter((v) => v.type === 'Shorts').length, '≤ 60s, or ≤ 3 min tagged #shorts'],
    ['Views (analysed)', fmtNum(sum(own, 'views')), 'Total views of the analysed videos'],
    ['Avg views / video', fmtNum(avg(own, 'views')), 'Views ÷ analysed videos'],
    ['Engagement rate', (er(own) * 100).toFixed(2) + '%', '(likes + comments) ÷ views. 1–3% typical, 5%+ strong'],
    ['Avg SEO score', Math.round(avg(own, 'seoScore')), 'Out of 100. See "How Scores Work"'],
    ['Avg CTA score', Math.round(avg(own.map((v) => ({ s: v.cta.score })), 's')), 'Out of 100. CTA present, above the fold, links'],
    ['Avg performance', Math.round(avg(own, 'perfScore')), 'Out of 100. Reach + momentum + engagement'],
  ] : [];

  const topGroup = (key) => {
    let best = { k: '—', v: 0 };
    for (const [k, rows] of groupBy(videos, key)) { const v = sum(rows, 'views'); if (v > best.v) best = { k, v }; }
    return best;
  };

  const reports = [];

  reports.push({
    id: 'dashboard', title: 'Executive Dashboard', kpis,
    sections: [
      {
        title: 'Channel benchmark',
        columns: [C('Channel'), C('Type'), C('Subscribers', 'num'), C('Videos', 'num'), C('Views', 'num'), C('Avg views', 'num'), C('Eng. rate', 'pct'), C('Videos/mo', 'num'), C('Avg SEO', 'num'), C('Avg CTA', 'num'), C('Authority', 'num'), C('Perf rank', 'num'), C('Publishing rank', 'num'), C('Engagement rank', 'num')],
        rows: bench.map((b) => [b.c.title, b.c.type, b.c.subscribers, b.rows.length, b.tv, Math.round(b.avgV), b.er, round1(b.vpm), Math.round(b.seo), Math.round(b.cta), authority(b), rPerf(b), rPub(b), rEng(b)]),
      },
      {
        title: 'Content intelligence summary',
        columns: [C('Metric'), C('Value'), C('Context')],
        rows: [
          ['Winning theme', topGroup('theme').k, fmtNum(topGroup('theme').v) + ' views'],
          ['Winning format', topGroup('format').k, fmtNum(topGroup('format').v) + ' views'],
          ['Winning length', topGroup('lengthBucket').k, fmtNum(topGroup('lengthBucket').v) + ' views'],
          ['Top intent', topGroup('intent').k, fmtNum(topGroup('intent').v) + ' views'],
          ['Top performer videos', videos.filter((v) => v.perfTier === 'Top Performer').length, 'Performance score 80+'],
          ['Videos analysed', videos.length, `${own.length} own | ${comps.length} competitor`],
        ],
      },
    ],
  });

  // Publishing frequency
  const overview = [], monthly = [], dow = [], insights = [];
  for (const c of channels) {
    const rows = videos.filter((v) => v.channelId === c.id);
    if (!rows.length) continue;
    const ts = rows.map((r) => r.ts);
    const first = Math.min(...ts), last = Math.max(...ts);
    const activeMonths = Math.max(1, (last - first) / (DAY * 30));
    const vpm = rows.length / activeMonths;
    const gap = rows.length > 1 ? Math.round((last - first) / (DAY * (rows.length - 1))) : 0;
    const byMonthKey = [...groupBy(rows, 'monthKey')].sort((a, b) => a[0].localeCompare(b[0]));
    const monthViews = byMonthKey.map(([k, r]) => ({ k, v: sum(r, 'views'), n: r.length }));
    const bestM = monthViews.reduce((a, b) => (b.v > a.v ? b : a), { k: '—', v: -1 });
    const weakM = monthViews.reduce((a, b) => (b.v < a.v ? b : a), { k: '—', v: Infinity });
    const days = DAY_ORDER.map((d) => { const r = rows.filter((x) => x.day === d); return { d, n: r.length, avgV: avg(r, 'views'), er: er(r) }; });
    const bestDay = [...days].sort((a, b) => b.avgV - a.avgV)[0];
    const cadence = vpm >= 4 ? 'Weekly or more' : vpm >= 2 ? '2–3 per month' : vpm >= 1 ? 'Monthly' : 'Irregular';
    overview.push([c.title, new Date(first).toISOString().slice(0, 10), new Date(last).toISOString().slice(0, 10), Math.round(activeMonths), rows.length, round1(vpm), gap, rows.filter((r) => r.type === 'Long Form').length, rows.filter((r) => r.type === 'Shorts').length, Math.min(100, Math.round(vpm * 20)), bestM.k, weakM.k, bestDay.d, cadence]);

    let prev = 0;
    byMonthKey.forEach(([k, r], i) => {
      const tv = sum(r, 'views');
      const win = (n) => { const s = byMonthKey.slice(Math.max(0, i - n + 1), i + 1); return Math.round(s.reduce((a, [, x]) => a + sum(x, 'views'), 0) / s.length); };
      monthly.push([c.title, k, r.length, r.filter((x) => x.type === 'Long Form').length, r.filter((x) => x.type === 'Shorts').length, tv, Math.round(avg(r, 'views')), er(r), prev ? (tv - prev) / prev : 0, win(3), win(6)]);
      prev = tv;
    });

    [...days].sort((a, b) => b.avgV - a.avgV).forEach((d, i) => {
      dow.push([c.title, d.d, d.n, Math.round(d.avgV), d.er, i + 1, i === 0 ? 'Best day — prioritise' : i === 1 ? 'Strong day' : i >= 5 ? 'Avoid' : '']);
    });

    if (bestM.v >= 0) insights.push([c.title, 'Best month', `${bestM.k}: ${fmtNum(bestM.v)} views from ${bestM.n} videos`, 'High', 'Replicate the cadence and topic mix from this month.']);
    insights.push([c.title, 'Cadence', `${round1(vpm)} videos/month, ~${gap} days between uploads`, vpm >= 3 ? 'Low' : 'High',
      vpm >= 4 ? 'Maintain weekly publishing.' : vpm >= 2 ? 'Move to weekly publishing.' : 'Publishing is low. Aim for at least 2 videos per month.']);
  }
  reports.push({
    id: 'publishing', title: 'Publishing Frequency',
    sections: [
      { title: 'Channel overview', columns: [C('Channel'), C('First upload', 'date'), C('Latest upload', 'date'), C('Active months', 'num'), C('Videos', 'num'), C('Videos/mo', 'num'), C('Days between', 'num'), C('Long form', 'num'), C('Shorts', 'num'), C('Consistency', 'num'), C('Best month'), C('Weakest month'), C('Best day'), C('Cadence')], rows: overview },
      { title: 'Monthly', columns: [C('Channel'), C('Month'), C('Videos', 'num'), C('Long form', 'num'), C('Shorts', 'num'), C('Views', 'num'), C('Avg views', 'num'), C('Eng. rate', 'pct'), C('MoM change', 'pct'), C('3-mo avg views', 'num'), C('6-mo avg views', 'num')], rows: monthly },
      { title: 'Day of week (UTC)', columns: [C('Channel'), C('Day'), C('Videos', 'num'), C('Avg views', 'num'), C('Eng. rate', 'pct'), C('Rank', 'num'), C('Recommendation')], rows: dow },
      { title: 'Auto insights', columns: [C('Channel'), C('Insight'), C('Finding'), C('Impact', 'status'), C('Action')], rows: insights },
    ],
  });

  // Video length
  const byBucket = groupBy(videos, 'lengthBucket');
  reports.push({
    id: 'length', title: 'Video Length',
    sections: [{
      title: 'Length bucket performance',
      columns: [C('Bucket'), C('Videos', 'num'), C('Long form', 'num'), C('Shorts', 'num'), C('Views', 'num'), C('Avg views', 'num'), C('Eng. rate', 'pct'), C('Avg views/day', 'num'), C('Best video'), C('URL', 'url'), C('Recommendation')],
      rows: LENGTH_BUCKETS.map((b) => {
        const r = byBucket.get(b) || [];
        if (!r.length) return [b, 0, 0, 0, 0, 0, 0, 0, '—', '', '—'];
        const best = [...r].sort(byViewsDesc)[0];
        const overallAvg = avg(videos, 'views');
        const a = avg(r, 'views');
        const rec = a >= overallAvg * 1.5 ? 'High priority length — produce more' : a >= overallAvg ? 'Above average — continue' : a >= overallAvg * 0.5 ? 'Average — test titles and topics' : 'Underperforming — review';
        return [b, r.length, r.filter((x) => x.type === 'Long Form').length, r.filter((x) => x.type === 'Shorts').length, sum(r, 'views'), Math.round(a), er(r), round1(avg(r, 'vpd')), best.title, best.url, rec];
      }),
      note: 'Recommendations compare each bucket with the average across all analysed videos, so they scale to any channel size.',
    }],
  });

  // Theme / format / intent
  const dimension = (key, label, order) => {
    const out = [];
    for (const c of channels) {
      const rows = videos.filter((v) => v.channelId === c.id);
      const g = groupBy(rows, key);
      const keys = order || [...g.keys()].sort();
      for (const k of keys) {
        const r = g.get(k) || [];
        if (!r.length && !order) continue;
        const best = [...r].sort(byViewsDesc)[0];
        out.push([k, c.title, c.type, r.length, sum(r, 'views'), Math.round(avg(r, 'views')), er(r), round1(avg(r, 'vpd')), rows.length ? r.length / rows.length : 0, best ? best.title : '—']);
      }
    }
    return { title: label + ' by channel', columns: [C(label), C('Channel'), C('Type'), C('Videos', 'num'), C('Views', 'num'), C('Avg views', 'num'), C('Eng. rate', 'pct'), C('Avg views/day', 'num'), C('Share of uploads', 'pct'), C('Top video')], rows: out };
  };
  reports.push({ id: 'theme', title: 'Themes', sections: [dimension('theme', 'Theme')] });
  reports.push({ id: 'format', title: 'Formats', sections: [dimension('format', 'Format')] });
  reports.push({ id: 'intent', title: 'Intent / Funnel', sections: [dimension('intent', 'Intent', INTENT_ORDER)] });

  // Thumbnails
  reports.push({
    id: 'thumbnails', title: 'Thumbnails', gallery: true,
    sections: [{
      title: 'All videos by views',
      columns: [C('Thumbnail', 'thumb'), C('Channel'), C('Title'), C('URL', 'url'), C('Type'), C('Views', 'num'), C('Eng. rate', 'pct'), C('Tier', 'status'), C('HD custom thumb', 'status')],
      rows: [...videos].sort(byViewsDesc).map((v) => [v.thumb, v.channel, v.title, v.url, v.type, v.views, v.er, v.perfTier, v.hasMaxresThumb ? 'Yes' : 'No']),
      note: '"HD custom thumb = No" means YouTube has no 1280×720 version, which usually means the thumbnail was auto-generated or uploaded at low resolution. Run the AI thumbnail review for a visual score.',
    }],
  });

  // Top / under performers
  const topCols = [C('#', 'num'), C('Channel'), C('Title'), C('URL', 'url'), C('Views', 'num'), C('Eng. rate', 'pct'), C('Duration'), C('Theme'), C('Format'), C('Intent'), C('Published', 'date'), C('Views/day', 'num')];
  const topRow = (v, i) => [i + 1, v.channel, v.title, v.url, v.views, v.er, v.duration, v.theme, v.format, v.intent, v.published, round1(v.vpd)];
  const byPerf = [...videos].sort((a, b) => b.perfScore - a.perfScore);
  reports.push({
    id: 'top', title: 'Top Content',
    sections: [
      { title: 'Top 25 by views', columns: topCols, rows: [...videos].sort(byViewsDesc).slice(0, 25).map(topRow) },
      { title: 'Top 10% by performance score', columns: topCols, rows: byPerf.slice(0, Math.max(1, Math.floor(byPerf.length * 0.1))).map(topRow) },
    ],
  });
  const aged = videos.filter((v) => now - v.ts > 14 * DAY).sort((a, b) => a.perfScore - b.perfScore).slice(0, 50);
  reports.push({
    id: 'under', title: 'Underperforming',
    sections: [{
      title: 'Lowest performance score (older than 14 days)',
      columns: [C('#', 'num'), C('Channel'), C('Title'), C('URL', 'url'), C('Views', 'num'), C('Eng. rate', 'pct'), C('Perf score', 'num'), C('Why (performance points)'), C('SEO', 'num'), C('CTA', 'num'), C('Theme'), C('Action')],
      rows: aged.map((v, i) => [i + 1, v.channel, v.title, v.url, v.views, v.er, v.perfScore, explainParts(v.perfParts), v.seoScore, v.cta.score, v.theme,
        v.type === 'Shorts' ? 'Review Shorts strategy for this topic' : v.seoScore < 50 ? 'Fix title, description and hashtags first' : !v.hasMaxresThumb ? 'Upload a custom HD thumbnail' : v.views < 500 ? 'Republish with a stronger title and thumbnail' : 'Review topic relevance and thumbnail']),
    }],
  });

  // Content gap (keyword similarity, not random)
  const ownKw = own.map((v) => ({ v, k: keywords(v.title) }));
  const common = [], missing = [];
  for (const cv of comps) {
    const ck = keywords(cv.title);
    let best = { s: 0, v: null };
    for (const o of ownKw) { const s = similarity(ck, o.k); if (s > best.s) best = { s, v: o.v }; }
    if (best.s >= 0.25) {
      common.push([best.v.title, best.v.url, cv.title, cv.url, cv.channel, cv.theme, best.s, best.v.views, cv.views, cv.views - best.v.views]);
    } else if (best.s < 0.1) {
      const opp = Math.min(100, Math.round(Math.log10(Math.max(1, cv.views)) * 12 + Math.min(40, cv.vpd / 5)));
      missing.push([cv.channel, cv.title, cv.url, cv.theme, cv.format, cv.views, round1(cv.vpd), opp, opp >= 70 ? 'High' : opp >= 45 ? 'Medium' : 'Low']);
    }
  }
  common.sort((a, b) => Math.abs(b[9]) - Math.abs(a[9]));
  missing.sort((a, b) => b[7] - a[7]);
  const ownThemes = new Set(own.map((v) => v.theme));
  const multi = [];
  for (const [theme, r] of groupBy(comps, 'theme')) {
    if (ownThemes.has(theme) || theme === 'Other') continue;
    const names = [...new Set(r.map((x) => x.channel))];
    if (names.length < 2) continue;
    multi.push([theme, names.length, names.join(', '), sum(r, 'views'), Math.round(avg(r, 'views')), Math.max(...r.map((x) => x.views)), names.length >= 3 ? 'High' : 'Medium', [...r].sort(byViewsDesc)[0].title]);
  }
  multi.sort((a, b) => b[3] - a[3]);
  reports.push({
    id: 'gap', title: 'Content Gaps',
    sections: [
      { title: 'Topics both sides cover', columns: [C('Our video'), C('Our URL', 'url'), C('Competitor video'), C('Competitor URL', 'url'), C('Competitor'), C('Theme'), C('Similarity', 'pct'), C('Our views', 'num'), C('Their views', 'num'), C('Views gap', 'num')], rows: common.slice(0, 50) },
      { title: 'Competitor topics we have not covered', columns: [C('Competitor'), C('Title'), C('URL', 'url'), C('Theme'), C('Format'), C('Views', 'num'), C('Views/day', 'num'), C('Opportunity', 'num'), C('Priority', 'status')], rows: missing.slice(0, 100) },
      { title: 'Themes 2+ competitors cover and we do not', columns: [C('Theme'), C('Competitors', 'num'), C('Names'), C('Total views', 'num'), C('Avg views', 'num'), C('Best single video', 'num'), C('Priority', 'status'), C('Their best title')], rows: multi },
    ],
  });

  // SEO + CTA audit
  const seoRows = videos.map((v) => {
    const ts = titleStatus(v.title), ds = descStatus(v.desc), hs = hashtagStatus(v.hashCount);
    return [v.channel, v.title, v.url, v.titleLen, ts, KEYWORD_SIGNAL.test(v.title) ? 'Yes' : 'No', v.descLen, ds, v.hasChapters ? 'Yes' : 'No', v.cta.types.join(', ') || 'None', v.cta.aboveFold ? 'Yes' : 'No', v.cta.score, v.hashCount, hs, v.seoScore, overallStatus(ts, ds, hs), explainParts(v.seoParts), explainParts(v.cta.parts)];
  });
  const order = { Weak: 0, Average: 1, Strong: 2 };
  seoRows.sort((a, b) => order[a[15]] - order[b[15]]);
  reports.push({
    id: 'seo', title: 'SEO & CTA Audit',
    sections: [{
      title: 'Title, description, CTA and hashtag audit',
      columns: [C('Channel'), C('Title'), C('URL', 'url'), C('Title len', 'num'), C('Title', 'status'), C('Keyword signal', 'status'), C('Desc len', 'num'), C('Description', 'status'), C('Chapters', 'status'), C('CTA types'), C('CTA above fold', 'status'), C('CTA score', 'num'), C('Hashtags', 'num'), C('Hashtag status', 'status'), C('SEO score', 'num'), C('Overall', 'status'), C('Why (SEO points)'), C('Why (CTA points)')],
      rows: seoRows,
    }],
  });

  // Recommendations (own channel only)
  const reco = [];
  for (const v of own) {
    const ts = titleStatus(v.title), ds = descStatus(v.desc), hs = hashtagStatus(v.hashCount);
    if (ts !== 'Strong') reco.push([v.url, 'Title', v.title, titleRec(v.title), ts, ts === 'Weak' ? 'High' : 'Medium', `${v.titleLen} chars, target 40–75`]);
    if (ds !== 'Strong') reco.push([v.url, 'Description', v.desc.slice(0, 80) + '…', descRec(v.title, v.desc), ds, ds === 'Weak' ? 'High' : 'Medium', `${v.descLen} chars, target 180–500`]);
    if (hs !== 'Strong') reco.push([v.url, 'Hashtags', v.hashtags.join(' ') || '(none)', hashtagRec(v.title), hs, hs === 'Weak' ? 'Medium' : 'Low', `${v.hashCount} hashtags, target 2–8`]);
    if (!v.cta.aboveFold) reco.push([v.url, 'CTA', v.cta.types.join(', ') || '(none)', 'Put one clear CTA with a link in the first 2 lines of the description.', v.cta.types.length ? 'Average' : 'Weak', 'High', 'Only the first ~150 characters show before "more"']);
    if (!v.hasChapters && v.type === 'Long Form' && v.durationSec > 240) reco.push([v.url, 'Chapters', '(none)', 'Add timestamps (0:00 Intro …) to get chapters and key moments in Google.', 'Weak', 'Medium', 'Chapters can appear as key moments in Google and AI answers']);
  }
  const pOrder = { High: 0, Medium: 1, Low: 2 };
  reco.sort((a, b) => pOrder[a[5]] - pOrder[b[5]]);
  reports.push({
    id: 'reco', title: 'Recommendations',
    sections: [{ title: 'Fixes for our channel (rule-based; use AI tab for rewrites)', columns: [C('URL', 'url'), C('Field'), C('Current'), C('Recommended'), C('Status', 'status'), C('Priority', 'status'), C('Notes')], rows: reco }],
  });

  reports.push(scoringGuide());
  return reports;
}

// Plain-language explanation of every score and status, shown as its own tab.
export function scoringGuide() {
  const cols = [C('Score / part'), C('Points', 'num'), C('Rule'), C('Why it matters')];
  return {
    id: 'guide', title: 'How Scores Work',
    sections: [
      { title: 'SEO score (0–100), per video', columns: cols, rows: [
        ['Title length', 25, '40–75 chars = 25 · 30–39 or 76+ = 12 · under 30 = 0', 'Room for the main keyword plus a hook, without being cut off in search and suggested videos.'],
        ['Description length', 25, '180+ chars = 25 · 100–179 = 12 · less = 0 (hashtags excluded)', 'YouTube and Google read the description to understand the topic; short ones give them nothing.'],
        ['Hashtags', 20, '2–8 = 20 · 1 = 10 · 0 or 9+ = 0', 'A few relevant hashtags add discovery pages; over 15 makes YouTube ignore them all.'],
        ['Tags', 15, '30+ chars of tags = 15 · some = 8 · none = 0', 'A minor signal, mostly for misspellings and variants.'],
        ['Keyword signal', 15, 'Title contains how to / guide / best / review / vs / year / number', 'These patterns match how people search, so the video is more likely to rank.'],
      ] },
      { title: 'Performance score (0–100), per video', columns: cols, rows: [
        ['Reach', 72, '12 × log10(views): 1K = 36, 10K = 48, 100K = 60, 1M = 72', 'A log scale, so a 1M-view video does not drown out everything else.'],
        ['Momentum', 40, 'views per day ÷ 20, capped at 40 (800+/day)', 'Rewards videos that are still pulling views, not just old ones.'],
        ['Engagement', 30, 'engagement rate × 400, capped at 30 (7.5%+)', 'Likes and comments per view show how strongly the audience responded.'],
        ['Tiers', '', '80+ Top Performer · 60–79 Above Average · 35–59 Average · <35 Low Performer', 'The total is capped at 100.'],
      ] },
      { title: 'CTA score (0–100), per video', columns: cols, rows: [
        ['Has a CTA', 40, 'Description asks to subscribe, comment, click a link, sign up/book, buy, or follow', 'Without an ask, viewers leave without acting.'],
        ['Above the fold', 30, 'A CTA within the first 3 lines / 150 characters', 'Only this part is visible before viewers tap "...more".'],
        ['Has a link', 15, 'At least one http(s) link', 'Gives the CTA somewhere to send people.'],
        ['Multiple CTA types', 15, 'Two or more CTA types', 'Covers viewers at different stages (subscribe now vs. buy later).'],
      ] },
      { title: 'Status labels', columns: [C('Label'), C('Strong', 'status'), C('Average', 'status'), C('Weak', 'status')], rows: [
        ['Title', '40–75 chars', '30–39 or 76+', 'under 30'],
        ['Description', '180+ chars', '80–179', 'under 80'],
        ['Hashtags', '2–8', '1 or 9', '0 or 10+'],
        ['Overall SEO', 'all three Strong', 'at least one Strong', 'none Strong'],
      ] },
      { title: 'Channel-level metrics', columns: [C('Metric'), C('Formula'), C('Meaning')], rows: [
        ['Engagement rate', '(likes + comments) ÷ views, over analysed videos', 'Audience response per view. 1–3% is typical; 5%+ is strong.'],
        ['Videos / month', 'videos ÷ months between first and latest analysed upload', 'Publishing cadence.'],
        ['Consistency', 'videos per month × 20, capped at 100 (5+/month = 100)', 'How regularly the channel publishes.'],
        ['Authority', '8 × log10(subscribers) + engagement (max 30) + cadence (max 20) + 10% of avg SEO', 'A blended 0–100 strength score for comparing channels.'],
        ['Ranks', 'Perf = avg views · Publishing = videos/month · Engagement = engagement rate', '1 = best among the channels in this audit.'],
        ['Shorts', '≤ 60s, or ≤ 3 min tagged #shorts', 'The API has no Shorts flag, so this is an estimate.'],
        ['Content gap', 'title keyword overlap (Jaccard): ≥ 25% = both cover it; < 10% = we have not covered it', 'Finds competitor topics missing from our channel.'],
        ['Opportunity', '12 × log10(views) + views/day ÷ 5 (max 40), capped at 100. High ≥ 70, Medium ≥ 45', 'How much demand a missing topic has shown.'],
      ] },
    ],
  };
}

// ── "Who's winning & why": plain-language comparison ─────────
// Compares our channel with each competitor on a few simple measures and
// explains each one in words a child could follow.
const pct = (x) => Math.round(x * 100) + '%';
const times = (a, b) => (b > 0 ? a / b : Infinity);
function sayTimes(r) {
  if (!isFinite(r)) return 'way more';
  if (r >= 1.95) return `${Math.round(r * 10) / 10}× more`;
  return `${Math.round((r - 1) * 100)}% more`;
}

export const STORY_METRICS = [
  {
    key: 'avgViews', icon: '👀', title: 'Views per video', tab: 'top',
    value: (rows) => avg(rows, 'views'), show: (v) => fmtNum(v),
    what: 'How many people watch each video, on average.',
    why: 'More views per video means people like the topics and click on the videos.',
    tip: 'Copy what works: look at their top videos (Top Content tab) and make your own version of those topics.',
  },
  {
    key: 'uploads', icon: '📅', title: 'Videos per month', tab: 'publishing',
    value: (rows) => videosPerMonth(rows), show: (v) => (Math.round(v * 10) / 10).toString(),
    what: 'How often the channel posts a new video.',
    why: 'Every new video is another ticket in the YouTube lottery. More tickets, more chances to be found.',
    tip: 'Pick a steady rhythm, like 2 videos every week, and stick to it.',
  },
  {
    key: 'engagement', icon: '❤️', title: 'Likes & comments', tab: 'top',
    value: (rows) => er(rows), show: (v) => (v * 100).toFixed(2) + '%',
    what: 'Out of every 100 viewers, how many like or comment.',
    why: 'When people like and comment, YouTube thinks "people love this!" and shows it to more people.',
    tip: 'Ask a simple question in the video and pin a comment. Reply to comments in the first hour.',
  },
  {
    key: 'momentum', icon: '🚀', title: 'Fresh video speed', tab: 'top',
    value: (rows) => avg([...rows].sort((a, b) => b.ts - a.ts).slice(0, 10), 'vpd'), show: (v) => fmtNum(v) + '/day',
    what: 'How fast the newest 10 videos are collecting views each day.',
    why: 'This shows who is growing right now, not just who was big in the past.',
    tip: 'Make more of what your newest best video did, while the topic is hot.',
  },
  {
    key: 'seo', icon: '🔎', title: 'Title & description score', tab: 'seo',
    value: (rows) => avg(rows, 'seoScore'), show: (v) => Math.round(v) + '/100',
    what: 'How well titles, descriptions and hashtags help people find the video in search.',
    why: 'YouTube and Google read the words. Good words = shown for more searches.',
    tip: 'Titles of 40–75 letters with the main words first, a 2–3 line description, and 2–8 hashtags.',
  },
  {
    key: 'cta', icon: '👉', title: 'Asking viewers to act', tab: 'seo',
    value: (rows) => avg(rows.map((r) => ({ s: r.cta.score })), 's'), show: (v) => Math.round(v) + '/100',
    what: 'Does the description tell viewers what to do next (subscribe, click, buy) right at the top?',
    why: 'If you don\'t ask, people just leave. Asking early turns viewers into customers.',
    tip: 'Put one clear ask with a link in the first 2 lines of every description.',
  },
  {
    key: 'thumbs', icon: '🖼️', title: 'HD custom thumbnails', tab: 'thumbnails',
    value: (rows) => (rows.length ? rows.filter((r) => r.hasMaxresThumb).length / rows.length : 0), show: pct,
    what: 'How many videos have a sharp, custom-made cover picture.',
    why: 'The thumbnail is the shop window. A clear, bright picture gets more clicks.',
    tip: 'Make a custom 1280×720 thumbnail for every video: big face, 3–4 big words, bright colours.',
  },
  {
    key: 'shorts', icon: '⚡', title: 'Shorts usage', tab: 'length',
    value: (rows) => (rows.length ? rows.filter((r) => r.type === 'Shorts').length / rows.length : 0), show: pct, neutral: true,
    what: 'What share of uploads are Shorts (quick vertical videos).',
    why: 'Shorts bring new people cheaply; long videos build trust. Winners usually do both.',
    tip: 'Cut 2–3 Shorts from every long video and link back to it.',
  },
  {
    key: 'health', icon: '🩺', title: 'Overall channel health', tab: 'health', channelValue: (c) => c._health ?? 0,
    value: () => 0, show: (v) => Math.round(v) + '/100',
    what: 'One score that adds up titles, thumbnails, topic focus, upload rhythm, setup, chapters, engagement and calls to action.',
    why: 'It shows at a glance which channel is set up best to be recommended by YouTube.',
    tip: 'Open the Health Score tab and fix your lowest part first; that\'s the cheapest win.',
  },
  {
    key: 'focus', icon: '🎯', title: 'Topic focus', tab: 'health',
    value: (rows) => topicFocus(rows).score ?? 0, show: (v) => Math.round(v) + '/100',
    what: 'How many videos stick to the channel\'s main topics.',
    why: 'YouTube recommends channels it can clearly label. A focused channel gets shown to the right people.',
    tip: 'Pick 3–5 core topics and make most videos about them.',
  },
  {
    key: 'rhythm', icon: '⏱️', title: 'Upload rhythm', tab: 'publishing',
    value: (rows) => uploadConsistency(rows).score ?? 0, show: (v) => Math.round(v) + '/100',
    what: 'How steady the gaps between uploads are.',
    why: 'Viewers and YouTube both like knowing when the next video comes.',
    tip: 'Choose fixed upload days (e.g. every Tuesday and Friday) and schedule videos in advance.',
  },
  {
    key: 'subs', icon: '👥', title: 'Subscribers', tab: 'dashboard', channelValue: (c) => c.subscribers,
    value: () => 0, show: (v) => fmtNum(v),
    what: 'How many people follow the channel.',
    why: 'Subscribers see new videos first, so each upload starts strong.',
    tip: 'Ask for the subscribe at the moment you deliver value, not at the very start.',
  },
];

export function buildStory(channels, videos) {
  const own = channels.find((c) => c.type === 'Own');
  const comps = channels.filter((c) => c.type !== 'Own');
  const rowsOf = (c) => videos.filter((v) => v.channelId === c.id);
  const items = STORY_METRICS.map((m) => {
    const values = channels.map((c) => ({ name: c.title, type: c.type, value: m.channelValue ? m.channelValue(c) : m.value(rowsOf(c)) }));
    const you = own ? values.find((v) => v.type === 'Own') : null;
    const others = values.filter((v) => v.type !== 'Own');
    const best = others.reduce((a, b) => (b.value > (a?.value ?? -Infinity) ? b : a), null);
    let winner = 'none', sentence;
    if (!you || !best) {
      sentence = `${m.what}`;
    } else if (m.neutral) {
      winner = 'info';
      sentence = `You: ${m.show(you.value)} of uploads are Shorts. ${best.name}: ${m.show(best.value)}.`;
    } else if (best.value > you.value * 1.1) {
      winner = 'them';
      sentence = `${best.name} gets ${sayTimes(times(best.value, you.value))} than you (${m.show(best.value)} vs ${m.show(you.value)}).`;
    } else if (you.value > best.value * 1.1) {
      winner = 'you';
      sentence = `You beat everyone here: ${m.show(you.value)} vs ${best.name}'s ${m.show(best.value)}.`;
    } else {
      winner = 'tie';
      sentence = `Neck and neck: you ${m.show(you.value)}, ${best.name} ${m.show(best.value)}.`;
    }
    return { key: m.key, icon: m.icon, title: m.title, what: m.what, why: m.why, tip: m.tip, tab: m.tab, winner, sentence, values, show: m.show };
  });
  const youWin = items.filter((i) => i.winner === 'you').length;
  const theyWin = items.filter((i) => i.winner === 'them').length;
  const headline = !own ? 'Add your own channel to see who is winning.'
    : !comps.length ? 'Add competitors to see who is winning.'
    : youWin > theyWin ? `🏆 You're ahead! You win ${youWin} of ${youWin + theyWin} contests.`
    : youWin === theyWin ? `🤝 It's close: you win ${youWin}, competitors win ${theyWin}.`
    : `📈 Competitors are ahead in ${theyWin} of ${youWin + theyWin} contests. Here's how to catch up.`;
  return { headline, youWin, theyWin, items };
}

// ── Channel health (ideas adapted from deeployCO/youtube-seo-skills, MIT) ──
// Every part is 0–100 with a plain-language reason; the total is a weighted
// average of the parts we can measure (missing data is left out, not guessed).
export const HEALTH_PARTS = [
  { key: 'metadata', label: 'Titles & descriptions', weight: 18, what: 'Average SEO score of titles, descriptions and hashtags.' },
  { key: 'thumbs', label: 'Thumbnails', weight: 15, what: 'Custom HD thumbnails, plus contrast and colour when measured.' },
  { key: 'focus', label: 'Topic focus', weight: 12, what: 'How many videos stick to the channel\'s main topics. Focused channels get recommended more.' },
  { key: 'consistency', label: 'Upload rhythm', weight: 10, what: 'How regular the gaps between uploads are (steady beats random bursts).' },
  { key: 'setup', label: 'Channel setup', weight: 8, what: 'Channel description, keywords, trailer and playlists.' },
  { key: 'discover', label: 'Discoverability', weight: 7, what: 'Chapters on long videos and good hashtags.' },
  { key: 'engagement', label: 'Engagement', weight: 5, what: 'Likes + comments per view (5%+ gets full marks).' },
  { key: 'cta', label: 'Calls to action', weight: 5, what: 'Clear asks (subscribe, link, buy) near the top of descriptions.' },
  { key: 'retention', label: 'Retention', weight: 25, what: 'Average % of each video watched (only with Connect YouTube; 60%+ = full marks).' },
];
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));

export function topicFocus(rows) {
  if (rows.length < 5) return { score: null, topics: [] };
  const freq = new Map();
  const kws = rows.map((r) => keywords(r.title));
  for (const k of kws) for (const w of k) freq.set(w, (freq.get(w) || 0) + 1);
  const top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  const covered = kws.filter((k) => top.some((w) => k.has(w))).length / rows.length;
  return { score: clamp(covered * 110), topics: top, covered };
}

export function uploadConsistency(rows) {
  const ts = rows.map((r) => r.ts).sort((a, b) => a - b).slice(-60);
  if (ts.length < 4) return { score: null };
  const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / 864e5);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  const cv = mean ? sd / mean : 0;
  return { score: clamp(100 - cv * 45), meanGap: mean, sdGap: sd, cv };
}

export function channelHealth(ch, rows, extra = {}) {
  const parts = {};
  const why = {};
  parts.metadata = rows.length ? clamp(avg(rows, 'seoScore')) : null;
  why.metadata = `Average SEO score ${parts.metadata}/100`;
  const hd = rows.length ? rows.filter((r) => r.hasMaxresThumb).length / rows.length : 0;
  const t = extra.thumbs;
  parts.thumbs = rows.length ? clamp(t ? hd * 50 + Math.min(25, (t.contrast / 60) * 25) + Math.min(25, (t.colorful / 60) * 25) : hd * 100) : null;
  why.thumbs = `${Math.round(hd * 100)}% have HD custom thumbnails` + (t ? `, contrast ${Math.round(t.contrast)}, colourfulness ${Math.round(t.colorful)}` : ' (run "Measure thumbnails" for colour & contrast)');
  const f = topicFocus(rows);
  parts.focus = f.score;
  why.focus = f.score == null ? 'Not enough videos' : `${Math.round(f.covered * 100)}% of videos are about: ${f.topics.join(', ')}`;
  const c = uploadConsistency(rows);
  parts.consistency = c.score;
  why.consistency = c.score == null ? 'Not enough uploads' : `About every ${Math.round(c.meanGap)} days, usually ±${Math.round(c.sdGap)} days`;
  if (ch.description != null && ch.keywords != null && ch.playlists !== undefined) {
    const pl = ch.playlists;
    const plCover = pl && ch.videoCount ? Math.min(1, pl.items / ch.videoCount) : 0;
    parts.setup = clamp((ch.description.length >= 150 ? 25 : ch.description.length >= 50 ? 12 : 0) + (ch.keywords ? 15 : 0) + (ch.hasTrailer ? 20 : 0) + plCover * 25 + (pl && pl.big >= 3 ? 15 : pl && pl.big ? 8 : 0));
    why.setup = [`description ${ch.description.length} chars`, ch.keywords ? 'has keywords' : 'no channel keywords', ch.hasTrailer ? 'has trailer' : 'no trailer', pl ? `${pl.count} playlists (${Math.round(plCover * 100)}% coverage)` : 'playlists unknown'].join(' · ');
  } else { parts.setup = null; why.setup = 'Re-run the audit to check channel setup'; }
  const long = rows.filter((r) => r.type === 'Long Form' && r.durationSec > 240);
  const chap = long.length ? long.filter((r) => r.hasChapters).length / long.length : null;
  const tags = rows.length ? rows.filter((r) => hashtagStatus(r.hashCount) === 'Strong').length / rows.length : 0;
  parts.discover = rows.length ? clamp((chap == null ? tags : (chap + tags) / 2) * 100) : null;
  why.discover = `${chap == null ? 'no long videos' : Math.round(chap * 100) + '% of long videos have chapters'} · ${Math.round(tags * 100)}% use 2–8 hashtags`;
  const e = er(rows);
  parts.engagement = rows.length ? clamp((e / 0.05) * 100) : null;
  why.engagement = `${(e * 100).toFixed(2)}% likes+comments per view`;
  parts.cta = rows.length ? clamp(avg(rows.map((r) => ({ s: r.cta.score })), 's')) : null;
  why.cta = `Average CTA score ${parts.cta}/100`;
  parts.retention = extra.avgViewPercentage != null ? clamp((extra.avgViewPercentage / 60) * 100) : null;
  why.retention = parts.retention == null ? 'Needs Connect YouTube (owner only)' : `${extra.avgViewPercentage.toFixed(1)}% of each video watched on average`;
  let wsum = 0, total = 0;
  for (const p of HEALTH_PARTS) if (parts[p.key] != null) { wsum += p.weight; total += parts[p.key] * p.weight; }
  return { score: wsum ? Math.round(total / wsum) : 0, parts, why, measuredWeight: wsum };
}

export function healthReport(channels, videos, extras = {}) {
  const rows = channels.map((c) => ({ c, h: channelHealth(c, videos.filter((v) => v.channelId === c.id), extras[c.id] || {}) }));
  const C = (l, f = 'text') => [l, f];
  return {
    id: 'health', title: 'Health Score', health: rows,
    sections: [
      {
        title: 'Channel Health Score (0–100)',
        columns: [C('Channel'), C('Type'), C('Health', 'num'), ...HEALTH_PARTS.map((p) => C(p.label, 'num'))],
        rows: rows.map(({ c, h }) => [c.title, c.type, h.score, ...HEALTH_PARTS.map((p) => (h.parts[p.key] == null ? '—' : h.parts[p.key]))]).sort((a, b) => b[2] - a[2]),
        note: 'Weights: ' + HEALTH_PARTS.map((p) => `${p.label} ${p.weight}%`).join(' · ') + '. Parts shown as — are not measured and are left out of the total (never guessed).',
      },
      {
        title: 'Why each channel scored that way',
        columns: [C('Channel'), C('Part'), C('Score', 'num'), C('Reason'), C('What it measures')],
        rows: rows.flatMap(({ c, h }) => HEALTH_PARTS.map((p) => [c.title, p.label, h.parts[p.key] == null ? '—' : h.parts[p.key], h.why[p.key], p.what])),
      },
    ],
  };
}
