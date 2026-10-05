// SEO analysis engine (runs in the browser): on-page checks, query/content coverage, site-level opportunities, scores.

const STOP = new Set(
  'a an and are as at be by for from how i in is it of on or the to what when where which who why with you your vs near me best top'.split(' ')
);

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
const tokens = (s) => norm(s).split(' ').filter(Boolean);
const stem = (t) => (t.length > 4 ? t.replace(/(ies|es|s|ing|ed)$/, '') : t);

function countPhrase(hay, phrase) {
  if (!phrase.length || hay.length < phrase.length) return 0;
  let n = 0;
  outer: for (let i = 0; i <= hay.length - phrase.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (hay[i + j] !== phrase[j]) continue outer;
    n++;
  }
  return n;
}

// fraction of meaningful query terms present in text tokens (light stemming)
function coverage(qTokens, textTokens) {
  const terms = qTokens.filter((t) => !STOP.has(t));
  const list = terms.length ? terms : qTokens;
  if (!list.length) return 0;
  const set = new Set(textTokens.map(stem));
  return list.filter((t) => set.has(stem(t))).length / list.length;
}

function match(qTokens, text) {
  const t = tokens(text);
  const exact = countPhrase(t, qTokens);
  return { exact, cov: coverage(qTokens, t) };
}

const level = (m) => (m.exact > 0 ? 1 : m.cov >= 0.8 ? 0.6 : m.cov >= 0.5 ? 0.3 : 0);

export function analyzeQueryCoverage(q, doc) {
  const qt = tokens(q.q);
  const parts = {
    title: match(qt, doc.title),
    h1: match(qt, doc.h1s.join(' ')),
    h2: match(qt, doc.subheads.join(' ')),
    meta: match(qt, doc.description),
    url: match(qt, decodeURIComponent(doc.path).replace(/[-_/]/g, ' ')),
    first100: match(qt, doc.first100),
  };
  const bodyCount = countPhrase(doc.bodyTokens, qt);
  const bodyCov = coverage(qt, doc.bodyTokens);
  const score =
    25 * level(parts.title) +
    15 * level(parts.h1) +
    10 * level(parts.h2) +
    10 * level(parts.meta) +
    10 * level(parts.first100) +
    15 * (bodyCount > 0 ? 1 : bodyCov * 0.7) +
    5 * level(parts.url) +
    10 * bodyCov;
  const density = doc.wordCount ? (bodyCount * qt.length * 100) / doc.wordCount : 0;
  return {
    query: q.q,
    clicks: q.c,
    impressions: q.i,
    ctr: q.ctr,
    position: q.p,
    inTitle: level(parts.title),
    inH1: level(parts.h1),
    inH2: level(parts.h2),
    inMeta: level(parts.meta),
    inUrl: level(parts.url),
    inFirst100: level(parts.first100),
    bodyCount,
    termCoverage: +bodyCov.toFixed(2),
    density: +density.toFixed(2),
    score: Math.round(score),
  };
}

function extract(html, pageUrl) {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const $ = (sel) => dom.querySelector(sel);
  const $$ = (sel) => [...dom.querySelectorAll(sel)];
  const attr = (sel, a) => $(sel)?.getAttribute(a)?.trim() || '';
  const u = new URL(pageUrl);

  const schemaTypes = [];
  for (const s of $$('script[type="application/ld+json"]')) {
    try {
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (o['@type']) schemaTypes.push(...[].concat(o['@type']));
        if (o['@graph']) walk(o['@graph']);
      };
      walk(JSON.parse(s.textContent));
    } catch {
      schemaTypes.push('(invalid JSON-LD)');
    }
  }

  const links = $$('a[href]').map((a) => {
    try {
      return new URL(a.getAttribute('href'), pageUrl);
    } catch {
      return null;
    }
  }).filter((l) => l && /^https?:$/.test(l.protocol));
  const sameHost = (l) => l.hostname.replace(/^www\./, '') === u.hostname.replace(/^www\./, '');
  const internal = links.filter(sameHost);
  const imgs = $$('img');

  const bodyEl = dom.body || dom.documentElement;
  bodyEl.querySelectorAll('script,style,noscript,svg,template,iframe').forEach((n) => n.remove());
  const main = bodyEl.querySelector('main, article, [role=main]') || bodyEl;
  const text = (main.textContent || '').replace(/\s+/g, ' ').trim();
  const bodyTokens = tokens(text);

  const h1s = $$('h1').map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const subheads = $$('h2,h3,h4').map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);

  return {
    title: ($('title')?.textContent || '').replace(/\s+/g, ' ').trim(),
    description: attr('meta[name="description" i]', 'content'),
    robots: attr('meta[name="robots" i]', 'content') + ' ' + attr('meta[name="googlebot" i]', 'content'),
    canonical: attr('link[rel="canonical" i]', 'href'),
    lang: dom.documentElement.getAttribute('lang') || '',
    viewport: attr('meta[name="viewport" i]', 'content'),
    ogTitle: attr('meta[property="og:title"]', 'content'),
    ogImage: attr('meta[property="og:image"]', 'content'),
    hreflang: $$('link[rel="alternate"][hreflang]').length,
    h1s,
    h2Count: $$('h2').length,
    subheads,
    images: imgs.length,
    imagesNoAlt: imgs.filter((i) => !(i.getAttribute('alt') || '').trim()).length,
    internalLinks: new Set(internal.map((l) => l.origin + l.pathname)).size,
    externalLinks: links.length - internal.length,
    schemaTypes: [...new Set(schemaTypes)],
    wordCount: bodyTokens.length,
    bodyTokens,
    first100: bodyTokens.slice(0, 100).join(' '),
    path: u.pathname,
  };
}

export function analyzePage(fetched, pageQueries = [], ga = null) {
  const checks = [];
  const add = (id, cat, label, weight, val, detail) => checks.push({ id, cat, label, weight, val, detail });
  const ok = fetched.status === 200 && fetched.html;

  if (!ok) {
    add('status', 'Technical', 'Page returns HTTP 200', 100, 0, `Status ${fetched.status}${fetched.error ? ' — ' + fetched.error : ''}`);
    return { url: fetched.url, status: fetched.status, checks, onpage_score: 0, content_score: 0, meta: null, queries: [], ga };
  }

  const d = extract(fetched.html, fetched.finalUrl);
  const robots = (d.robots + ' ' + (fetched.xRobotsTag || '')).toLowerCase();
  const tl = d.title.length;
  const dl = d.description.length;
  let canonAbs = '';
  try {
    canonAbs = d.canonical ? new URL(d.canonical, fetched.finalUrl).toString() : '';
  } catch {}
  const strip = (s) => s.replace(/[#?].*$/, '').replace(/\/$/, '');

  add('status', 'Technical', 'Page returns HTTP 200', 10, 1, `Status 200`);
  add('redirect', 'Technical', 'No redirect hops', 3, fetched.redirects.length ? 0.5 : 1,
    fetched.redirects.length ? `Redirects: ${fetched.redirects.map((r) => r.status).join(' → ')} to ${fetched.finalUrl}` : 'Direct');
  add('index', 'Technical', 'Indexable (no noindex)', 10, robots.includes('noindex') ? 0 : 1, robots.trim() || 'No robots directives');
  add('https', 'Technical', 'Served over HTTPS', 4, fetched.finalUrl.startsWith('https:') ? 1 : 0, '');
  add('canonical', 'Technical', 'Canonical tag present', 5, canonAbs ? 1 : 0, canonAbs || 'Missing');
  if (canonAbs) {
    const self = strip(canonAbs) === strip(fetched.finalUrl);
    add('canon-self', 'Technical', 'Canonical points to itself', 3, self ? 1 : 0.5, self ? 'Self-referencing' : `Points to ${canonAbs}`);
  }
  add('viewport', 'Technical', 'Mobile viewport meta', 4, d.viewport ? 1 : 0, d.viewport || 'Missing');
  add('lang', 'Technical', 'HTML lang attribute', 2, d.lang ? 1 : 0, d.lang || 'Missing');
  add('speed', 'Technical', 'Server response < 1.5s', 3, fetched.ms < 1500 ? 1 : fetched.ms < 3000 ? 0.5 : 0, `${fetched.ms} ms`);
  add('size', 'Technical', 'HTML size < 300 KB', 2, fetched.bytes < 300000 ? 1 : 0.5, `${Math.round(fetched.bytes / 1024)} KB`);

  add('title', 'Meta', 'Title tag present', 8, tl ? 1 : 0, d.title || 'Missing');
  if (tl) add('title-len', 'Meta', 'Title length 30–60 chars', 4, tl >= 30 && tl <= 60 ? 1 : tl > 10 && tl <= 70 ? 0.5 : 0, `${tl} chars`);
  add('desc', 'Meta', 'Meta description present', 6, dl ? 1 : 0, d.description || 'Missing');
  if (dl) add('desc-len', 'Meta', 'Meta description 70–160 chars', 3, dl >= 70 && dl <= 160 ? 1 : 0.5, `${dl} chars`);
  add('og', 'Meta', 'Open Graph title + image', 2, d.ogTitle && d.ogImage ? 1 : d.ogTitle || d.ogImage ? 0.5 : 0, '');

  add('h1', 'Structure', 'Exactly one H1', 7, d.h1s.length === 1 ? 1 : d.h1s.length > 1 ? 0.5 : 0,
    d.h1s.length ? d.h1s.slice(0, 3).join(' | ') : 'No H1');
  add('h2', 'Structure', 'Uses H2 subheadings', 3, d.h2Count ? 1 : 0, `${d.h2Count} H2s`);
  add('schema', 'Structure', 'Structured data (JSON-LD)', 4, d.schemaTypes.length ? 1 : 0, d.schemaTypes.join(', ') || 'None');
  add('internal', 'Structure', '≥ 5 internal links', 4, d.internalLinks >= 5 ? 1 : d.internalLinks ? 0.5 : 0, `${d.internalLinks} internal, ${d.externalLinks} external`);
  add('alt', 'Structure', 'Images have alt text', 5, !d.images ? 1 : d.imagesNoAlt / d.images <= 0.1 ? 1 : d.imagesNoAlt / d.images <= 0.4 ? 0.5 : 0,
    d.images ? `${d.imagesNoAlt}/${d.images} missing alt` : 'No images');

  add('words', 'Content', 'Sufficient content (≥ 300 words)', 6, d.wordCount >= 600 ? 1 : d.wordCount >= 300 ? 0.75 : d.wordCount >= 150 ? 0.4 : 0,
    `${d.wordCount} words`);

  const queries = pageQueries
    .slice()
    .sort((a, b) => b.i - a.i)
    .slice(0, 20)
    .map((q) => analyzeQueryCoverage(q, d));

  const top = queries.slice(0, 10);
  const totalImp = top.reduce((s, q) => s + q.impressions, 0);
  const qScore = totalImp ? top.reduce((s, q) => s + q.score * q.impressions, 0) / totalImp : null;
  if (top[0]) {
    add('topq-title', 'Content', `Top query in title: “${top[0].query}”`, 6, top[0].inTitle, '');
    add('topq-h1', 'Content', `Top query in H1`, 4, top[0].inH1, '');
  }

  const totalW = checks.reduce((s, c) => s + c.weight, 0);
  const onpage = (checks.reduce((s, c) => s + c.weight * c.val, 0) / totalW) * 100;
  const depth = Math.min(1, d.wordCount / 800) * 100;
  const content = qScore === null ? depth * 0.8 : qScore * 0.75 + depth * 0.25;

  const { bodyTokens, first100, subheads, ...meta } = d;
  return {
    url: fetched.url,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    ms: fetched.ms,
    checks,
    onpage_score: Math.round(onpage),
    content_score: Math.round(content),
    meta: { ...meta, subheads: subheads.slice(0, 30) },
    queries,
    ga,
  };
}

// ---------- site level ----------

const EXPECTED_CTR = [0.3, 0.16, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
export const expectedCtr = (pos) => EXPECTED_CTR[Math.max(0, Math.round(pos) - 1)] ?? 0.01;

export function opportunities(gsc, ga, pages) {
  const out = {};
  const qs = gsc.queries || [];
  const impSorted = qs.map((q) => q.i).sort((a, b) => b - a);
  const impThreshold = Math.max(20, impSorted[Math.floor(impSorted.length * 0.25)] || 0);

  out.quickWins = qs
    .filter((q) => q.p >= 4 && q.p <= 15 && q.i >= impThreshold)
    .sort((a, b) => b.i - a.i)
    .slice(0, 25)
    .map((q) => ({ ...q, page: bestPageFor(gsc, q.q) }));

  out.lowCtr = qs
    .filter((q) => q.p <= 6 && q.i >= impThreshold && q.ctr < expectedCtr(q.p) * 0.6)
    .map((q) => ({ ...q, expected: expectedCtr(q.p), lostClicks: Math.round(q.i * expectedCtr(q.p) - q.c), page: bestPageFor(gsc, q.q) }))
    .sort((a, b) => b.lostClicks - a.lostClicks)
    .slice(0, 25);

  const byQuery = {};
  for (const r of gsc.pageQueries || []) (byQuery[r.q] ||= []).push(r);
  out.cannibalization = Object.entries(byQuery)
    .map(([q, rows]) => {
      const total = rows.reduce((s, r) => s + r.i, 0);
      const competing = rows.filter((r) => r.i >= total * 0.15).sort((a, b) => b.i - a.i);
      return { q, total, pages: competing.map((r) => ({ u: r.u, i: r.i, c: r.c, p: r.p })) };
    })
    .filter((x) => x.pages.length >= 2 && x.total >= 50)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  const prevQ = Object.fromEntries((gsc.prevQueries || []).map((q) => [q.q, q]));
  const prevP = Object.fromEntries((gsc.prevPages || []).map((p) => [p.u, p]));
  out.decliningQueries = qs
    .filter((q) => prevQ[q.q] && prevQ[q.q].c >= 10 && q.c < prevQ[q.q].c * 0.7)
    .map((q) => ({ ...q, prevC: prevQ[q.q].c, prevP: prevQ[q.q].p }))
    .sort((a, b) => b.prevC - b.c - (a.prevC - a.c))
    .slice(0, 20);
  out.decliningPages = (gsc.pages || [])
    .filter((p) => prevP[p.u] && prevP[p.u].c >= 10 && p.c < prevP[p.u].c * 0.7)
    .map((p) => ({ ...p, prevC: prevP[p.u].c, prevP: prevP[p.u].p }))
    .sort((a, b) => b.prevC - b.c - (a.prevC - a.c))
    .slice(0, 20);
  out.risingQueries = qs
    .filter((q) => q.c >= 5 && (!prevQ[q.q] || q.c > prevQ[q.q].c * 1.5))
    .map((q) => ({ ...q, prevC: prevQ[q.q]?.c || 0 }))
    .sort((a, b) => b.c - b.prevC - (a.c - a.prevC))
    .slice(0, 15);

  out.contentGaps = [];
  for (const p of pages) {
    for (const q of (p.queries || []).slice(0, 5)) {
      if (q.impressions >= 30 && q.score < 50) {
        out.contentGaps.push({ u: p.url, q: q.query, i: q.impressions, p: q.position, score: q.score, missing: missingSpots(q) });
      }
    }
  }
  out.contentGaps.sort((a, b) => b.i - a.i).splice(30);

  out.lowEngagement = (ga?.landing || [])
    .filter((l) => l.sessions >= 30 && l.engagementRate < 0.45)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 15);

  return out;
}

export function missingSpots(q) {
  const m = [];
  if (q.inTitle < 1) m.push('title');
  if (q.inH1 < 1) m.push('H1');
  if (q.inH2 < 0.6) m.push('H2s');
  if (q.inMeta < 1) m.push('meta description');
  if (q.inFirst100 < 0.6) m.push('intro');
  if (!q.bodyCount) m.push('body copy');
  return m;
}

function bestPageFor(gsc, query) {
  let best = null;
  for (const r of gsc.pageQueries || []) if (r.q === query && (!best || r.i > best.i)) best = r;
  return best?.u || null;
}

export function siteChecks(pages, robotsRes, sitemapRes, homeUrl) {
  const checks = [];
  const add = (label, weight, val, detail) => checks.push({ label, weight, val, detail });
  const robotsOk = robotsRes?.status === 200 && robotsRes.html;
  add('robots.txt reachable', 2, robotsOk ? 1 : 0, robotsOk ? 'Found' : `Status ${robotsRes?.status ?? 'error'}`);
  if (robotsOk && /^\s*disallow:\s*\/\s*$/im.test(robotsRes.html) && /user-agent:\s*\*/i.test(robotsRes.html)) {
    add('robots.txt does not block whole site', 5, 0, 'Found "Disallow: /" — check it is not applied to all bots');
  }
  const smOk = sitemapRes?.status === 200 && /<(urlset|sitemapindex)/i.test(sitemapRes.html || '');
  add('XML sitemap found', 3, smOk ? 1 : 0, smOk ? sitemapRes.url : 'Not found at robots.txt Sitemap: or /sitemap.xml');

  const ok = pages.filter((p) => p.meta);
  const dupe = (key) => {
    const m = {};
    for (const p of ok) if (p.meta[key]) (m[p.meta[key]] ||= []).push(p.url);
    return Object.entries(m).filter(([, v]) => v.length > 1);
  };
  const dt = dupe('title');
  const dd = dupe('description');
  add('Unique titles across pages', 3, dt.length ? 0.3 : 1, dt.length ? `${dt.length} duplicated titles` : 'All unique');
  add('Unique meta descriptions', 2, dd.length ? 0.3 : 1, dd.length ? `${dd.length} duplicated descriptions` : 'All unique');
  const broken = pages.filter((p) => p.status !== 200);
  add('Crawled pages return 200', 4, broken.length ? Math.max(0, 1 - broken.length / pages.length * 3) : 1,
    broken.length ? `${broken.length} pages not 200: ${broken.slice(0, 3).map((p) => p.url).join(', ')}` : 'All OK');
  const noindex = ok.filter((p) => p.checks.find((c) => c.id === 'index')?.val === 0);
  add('Pages with search traffic are indexable', 4, noindex.length ? 0 : 1, noindex.length ? `${noindex.length} noindex pages` : 'OK');
  const home = pages.find((p) => p.url === homeUrl);
  if (home) add('Homepage healthy', 2, home.status === 200 ? 1 : 0, `Status ${home.status}`);

  const total = checks.reduce((s, c) => s + c.weight, 0);
  return {
    checks,
    duplicates: { titles: dt.slice(0, 20), descriptions: dd.slice(0, 20) },
    score: Math.round((checks.reduce((s, c) => s + c.weight * c.val, 0) / total) * 100),
  };
}

export function overallScores(pages, site) {
  const ok = pages.filter((p) => p.status === 200);
  // weight pages by impressions so important pages count more
  const w = (p) => 1 + Math.log10(1 + (p.gsc?.i || 0));
  const avg = (key) => {
    const tw = ok.reduce((s, p) => s + w(p), 0);
    return tw ? ok.reduce((s, p) => s + p[key] * w(p), 0) / tw : 0;
  };
  const onpage = Math.round(avg('onpage_score'));
  const content = Math.round(avg('content_score'));
  const technical = site.score;
  const overall = Math.round(onpage * 0.4 + content * 0.4 + technical * 0.2);
  return { overall, onpage, content, technical };
}
