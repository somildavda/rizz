// Content Gap API, served by the hub Worker under /api/cg/*.
// The browser drives the crawl one small request at a time, so each Worker
// invocation stays well under Cloudflare's subrequest limits.
//
//   GET  /api/cg/subdomains?domain=example.com   subdomains from certificate logs
//   GET  /api/cg/sitemap?host=www.example.com     page URLs from robots.txt/sitemaps
//   GET  /api/cg/page?url=https://...             title, H1, headings, text, links
//   POST /api/cg/ranked                           DataForSEO ranked keywords (proxy)

const UA = "Mozilla/5.0 (compatible; SearchVerseContentGap/1.0; +https://searchverse.app)";
const MAX_SITEMAP_URLS = 2000;
const MAX_TEXT = 6000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Only public http(s) hostnames: no IP literals, localhost or internal names.
function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (_) { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  return u;
}

const cleanHost = (s) =>
  String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/^\*\./, "");

// Follows redirects by hand so every hop is re-checked by safeUrl.
async function get(url, ms = 12000) {
  let current = String(url);
  for (let hop = 0; hop < 6; hop++) {
    if (!safeUrl(current)) throw new Error("Blocked URL");
    const r = await fetch(current, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "manual",
      signal: AbortSignal.timeout(ms),
    });
    const loc = r.status >= 300 && r.status < 400 && r.headers.get("Location");
    if (!loc) return { res: r, url: current };
    current = new URL(loc, current).toString();
  }
  throw new Error("Too many redirects");
}

async function subdomains(domain) {
  const root = cleanHost(domain).replace(/^www\./, "");
  if (!safeUrl("https://" + root)) return json({ error: "Invalid domain" }, 400);
  const found = new Set([root, "www." + root]);
  let source = "crt.sh";
  try {
    const { res: r } = await get(`https://crt.sh/?q=${encodeURIComponent("%." + root)}&output=json`, 25000);
    if (!r.ok) throw new Error("crt.sh " + r.status);
    for (const row of await r.json()) {
      for (const n of String(row.name_value || "").split("\n")) {
        const h = cleanHost(n);
        if (h === root || h.endsWith("." + root)) found.add(h);
      }
    }
  } catch (e) {
    source = "fallback (certificate log unavailable: " + e.message + ")";
  }
  return json({ domain: root, source, subdomains: [...found].sort() });
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) => m[1].replace(/&amp;/g, "&"));

async function sitemap(host) {
  host = cleanHost(host);
  if (!safeUrl("https://" + host)) return json({ error: "Invalid host" }, 400);
  const queue = [];
  try {
    const { res: r } = await get(`https://${host}/robots.txt`, 8000);
    if (r.ok) for (const m of (await r.text()).matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1]);
  } catch (_) {}
  if (!queue.length) queue.push(`https://${host}/sitemap.xml`, `https://${host}/sitemap_index.xml`);

  const urls = new Set(), seen = new Set(), sitemaps = [];
  let fetches = 0;
  while (queue.length && fetches < 25 && urls.size < MAX_SITEMAP_URLS) {
    const sm = queue.shift();
    if (seen.has(sm) || !safeUrl(sm)) continue;
    seen.add(sm); fetches++;
    try {
      const { res: r } = await get(sm, 10000);
      if (!r.ok) continue;
      const xml = await r.text();
      if (/<sitemapindex/i.test(xml)) queue.push(...locs(xml));
      else if (/<urlset/i.test(xml)) {
        sitemaps.push(sm);
        for (const l of locs(xml)) { if (urls.size >= MAX_SITEMAP_URLS) break; urls.add(l); }
      }
    } catch (_) {}
  }
  return json({ host, sitemaps, urls: [...urls] });
}

async function page(raw) {
  const u = safeUrl(raw);
  if (!u) return json({ error: "Invalid URL" }, 400);
  let r, finalUrl;
  try { ({ res: r, url: finalUrl } = await get(u.toString())); } catch (e) { return json({ url: u.toString(), ok: false, error: e.message }); }
  const type = r.headers.get("Content-Type") || "";
  if (!r.ok || !type.includes("html")) {
    return json({ url: u.toString(), finalUrl, ok: false, status: r.status, error: r.ok ? "Not HTML" : "HTTP " + r.status });
  }

  const d = { title: "", description: "", canonical: "", robots: "", lang: "", h1: [], h2: [], h3: [], links: [] };
  let text = "", cur = null, skip = 0;
  const grab = (key) => ({
    element(el) { cur = { key, buf: "" }; el.onEndTag(() => { const t = cur && cur.buf.replace(/\s+/g, " ").trim(); if (t) d[key].push(t.slice(0, 200)); cur = null; }); },
  });
  const res = new HTMLRewriter()
    .on("html", { element(el) { d.lang = el.getAttribute("lang") || ""; } })
    .on("title", { text(t) { d.title += t.text; } })
    .on('meta[name="description" i]', { element(el) { d.description = el.getAttribute("content") || ""; } })
    .on('meta[name="robots" i]', { element(el) { d.robots = el.getAttribute("content") || ""; } })
    .on('link[rel="canonical" i]', { element(el) { d.canonical = el.getAttribute("href") || ""; } })
    .on("h1", grab("h1")).on("h2", grab("h2")).on("h3", grab("h3"))
    .on("head, script, style, noscript, svg, nav, footer, header", {
      element(el) { skip++; el.onEndTag(() => { skip--; }); },
    })
    .on("a[href]", { element(el) { if (d.links.length < 400) d.links.push(el.getAttribute("href")); } })
    .on("*", {
      text(t) {
        if (cur) cur.buf += t.text;
        if (!skip && text.length < MAX_TEXT) text += t.text + " ";
      },
    })
    .transform(new Response(r.body, { headers: { "Content-Type": "text/html" } }));
  await res.text();

  const base = new URL(finalUrl);
  const links = new Set();
  for (const href of d.links) {
    try {
      const l = new URL(href, base);
      if (["http:", "https:"].includes(l.protocol)) { l.hash = ""; links.add(l.toString()); }
    } catch (_) {}
  }
  const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  return json({
    url: u.toString(), finalUrl, ok: true, status: r.status,
    title: decode(d.title), description: decode(d.description), canonical: d.canonical,
    robots: d.robots, lang: d.lang, h1: d.h1.map(decode), h2: d.h2.slice(0, 30).map(decode), h3: d.h3.slice(0, 30).map(decode),
    text: decode(text).slice(0, MAX_TEXT), links: [...links],
  });
}

// Proxies DataForSEO Labs "ranked keywords". The browser sends the user's own
// DataForSEO login; it is passed straight through and never stored here.
async function ranked(request) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Bad JSON" }, 400); }
  const { login, password, target, location_code = 2840, language_code = "en", limit = 1000 } = body || {};
  if (!login || !password || !target) return json({ error: "login, password and target are required" }, 400);
  const task = {
    target: cleanHost(target), location_code: Number(location_code), language_code,
    limit: Math.min(Number(limit) || 1000, 1000), load_rank_absolute: true,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  };
  const r = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(login + ":" + password), "Content-Type": "application/json" },
    body: JSON.stringify([task]),
  });
  const data = await r.json().catch(() => ({}));
  const t = data.tasks && data.tasks[0];
  if (!r.ok || !t || t.status_code !== 20000) {
    return json({ error: (t && t.status_message) || data.status_message || "DataForSEO HTTP " + r.status }, 502);
  }
  const items = (t.result && t.result[0] && t.result[0].items) || [];
  return json({
    target: task.target,
    total: (t.result && t.result[0] && t.result[0].total_count) || items.length,
    cost: t.cost,
    keywords: items.map((it) => {
      const kd = it.keyword_data || {}, info = kd.keyword_info || {}, s = (it.ranked_serp_element || {}).serp_item || {};
      return {
        keyword: kd.keyword,
        volume: info.search_volume || 0,
        cpc: info.cpc || 0,
        difficulty: (kd.keyword_properties || {}).keyword_difficulty ?? null,
        intent: ((kd.search_intent_info || {}).main_intent) || "",
        position: s.rank_group ?? null,
        url: s.url || "",
        etv: s.etv || 0,
      };
    }),
  });
}

export async function handleContentGap(request, url) {
  const p = url.pathname.replace(/^\/api\/cg\/?/, "");
  try {
    if (p === "subdomains") return await subdomains(url.searchParams.get("domain"));
    if (p === "sitemap") return await sitemap(url.searchParams.get("host"));
    if (p === "page") return await page(url.searchParams.get("url"));
    if (p === "ranked" && request.method === "POST") return await ranked(request);
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}
