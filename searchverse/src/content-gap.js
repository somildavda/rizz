// Content Gap API, served by the hub Worker under /api/cg/*.
// The browser drives the crawl one small request at a time, so each Worker
// invocation stays well under Cloudflare's subrequest limits.
//
//   GET  /api/cg/subdomains?domain=example.com   subdomains from certificate logs
//   GET  /api/cg/robots?host=www.example.com      sitemaps + Disallow rules from robots.txt
//   GET  /api/cg/sitemapfile?url=...              one sitemap file (index or URL set)
//   GET  /api/cg/page?url=https://...             title, H1, headings, text, links
//   GET  /api/cg/suggest?q=...                    Google Autocomplete suggestions (free)
//   POST /api/cg/serp                             positions from the user's SearXNG
//   POST /api/cg/gemini                           Gemini topic recommendations (proxy)

const UA = "Mozilla/5.0 (compatible; SearchVerseContentGap/1.0; +https://searchverse.app)";
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

// robots.txt for a host: the sitemaps it lists and the "User-agent: *" Disallow rules.
async function robots(host) {
  host = cleanHost(host);
  if (!safeUrl("https://" + host)) return json({ error: "Invalid host" }, 400);
  const sitemaps = [], disallow = [];
  try {
    const { res: r } = await get(`https://${host}/robots.txt`, 8000);
    if (r.ok) {
      const txt = await r.text();
      for (const m of txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)) sitemaps.push(m[1]);
      let all = false, inAgents = false;
      for (const line of txt.split(/\r?\n/)) {
        const m = line.replace(/#.*/, "").trim().match(/^([\w-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === "user-agent") { all = inAgents ? all || v === "*" : v === "*"; inAgents = true; continue; }
        inAgents = false;
        if (all && k === "disallow" && v) disallow.push(v);
      }
    }
  } catch (_) {}
  if (!sitemaps.length) sitemaps.push(`https://${host}/sitemap.xml`, `https://${host}/sitemap_index.xml`);
  return json({ host, sitemaps, disallow });
}

// One sitemap file: either an index (child sitemaps) or a URL set. The browser walks
// the tree one file per request, so there is no cap on the number of files or URLs.
async function sitemapFile(raw) {
  if (!safeUrl(raw)) return json({ error: "Invalid URL" }, 400);
  try {
    const { res: r } = await get(raw, 20000);
    if (!r.ok) return json({ url: raw, sitemaps: [], urls: [], error: "HTTP " + r.status });
    let body;
    if (/\.gz($|\?)/i.test(raw) && !/xml/.test(r.headers.get("Content-Type") || "")) {
      body = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
    } else body = await r.text();
    if (/<sitemapindex/i.test(body)) return json({ url: raw, sitemaps: locs(body), urls: [] });
    if (/<urlset/i.test(body)) return json({ url: raw, sitemaps: [], urls: locs(body) });
    return json({ url: raw, sitemaps: [], urls: [], error: "Not a sitemap" });
  } catch (e) {
    return json({ url: raw, sitemaps: [], urls: [], error: e.message });
  }
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

// Google Autocomplete (free, no key): confirms people search a phrase and
// returns related searches.
async function suggest(q, hl, gl) {
  if (!q) return json({ error: "q is required" }, 400);
  const u = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}&hl=${encodeURIComponent(hl || "en")}&gl=${encodeURIComponent(gl || "us")}`;
  const { res: r } = await get(u, 8000);
  if (!r.ok) return json({ error: "Autocomplete HTTP " + r.status }, 502);
  const data = JSON.parse(new TextDecoder("utf-8").decode(await r.arrayBuffer()));
  return json({ q, suggestions: Array.isArray(data[1]) ? data[1] : [] });
}

// A SearXNG instance's address: a public hostname, or a public IPv4 address
// (private, loopback and link-local ranges are refused).
function safeInstance(raw) {
  let u;
  try { u = new URL(raw); } catch (_) { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const m = u.hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
    return u;
  }
  return safeUrl(raw) ? u : null;
}

// Runs one query on the user's own SearXNG (open-source metasearch) and returns
// the ordered result URLs, so positions can be read for every site at once.
async function serp(request) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Bad JSON" }, 400); }
  const { instance, q, language = "en", engines = "", pages = 2 } = body || {};
  const base = instance && safeInstance(String(instance).replace(/\/+$/, ""));
  if (!base || !q) return json({ error: "A valid SearXNG address and q are required" }, 400);
  const results = [];
  for (let page = 1; page <= Math.min(Number(pages) || 2, 5); page++) {
    const u = new URL(base.toString().replace(/\/+$/, "") + "/search");
    u.searchParams.set("q", q); u.searchParams.set("format", "json");
    u.searchParams.set("language", language); u.searchParams.set("pageno", String(page));
    if (engines) u.searchParams.set("engines", engines);
    const r = await fetch(u.toString(), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (r.status === 403) return json({ error: "SearXNG refused JSON (enable `json` under search.formats in its settings.yml)" }, 502);
    if (!r.ok) return json({ error: "SearXNG HTTP " + r.status }, 502);
    const data = await r.json().catch(() => ({}));
    const rows = (data.results || []).map((x) => ({ url: x.url, title: x.title || "", engines: x.engines || [] }));
    if (!rows.length) break;
    results.push(...rows);
  }
  const seen = new Set();
  return json({ q, results: results.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url)).map((x, i) => ({ position: i + 1, ...x })) });
}

// Proxies one Gemini generateContent call with the user's own API key, asking
// for a JSON reply. The key is passed straight through and never stored.
async function gemini(request) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Bad JSON" }, 400); }
  const { key, model = "gemini-2.5-flash", prompt } = body || {};
  if (!key || !prompt) return json({ error: "key and prompt are required" }, 400);
  if (!/^[\w.-]{3,80}$/.test(model)) return json({ error: "Invalid model name" }, 400);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: String(prompt).slice(0, 900000) }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: (data.error && data.error.message) || "Gemini HTTP " + r.status }, 502);
  const cand = (data.candidates || [])[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((x) => x.text || "").join("");
  if (!text) return json({ error: "Gemini returned no text" + (cand && cand.finishReason ? " (" + cand.finishReason + ")" : "") }, 502);
  return json({ text, usage: data.usageMetadata || null });
}

export async function handleContentGap(request, url) {
  const p = url.pathname.replace(/^\/api\/cg\/?/, "");
  try {
    if (p === "subdomains") return await subdomains(url.searchParams.get("domain"));
    if (p === "robots") return await robots(url.searchParams.get("host"));
    if (p === "sitemapfile") return await sitemapFile(url.searchParams.get("url"));
    if (p === "page") return await page(url.searchParams.get("url"));
    if (p === "suggest") return await suggest(url.searchParams.get("q"), url.searchParams.get("hl"), url.searchParams.get("gl"));
    if (p === "serp" && request.method === "POST") return await serp(request);
    if (p === "gemini" && request.method === "POST") return await gemini(request);
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}
