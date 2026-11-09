// SearchVerse Content Gap engine: crawling, keyword extraction, rankings, gaps and
// topic scoring. No DOM access: the UI plugs in through `hooks` and reads `state`.
export var STOP = "a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further get had has have having he her here hers him his how i if in into is it its just like me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your yours new best top guide vs via per one two get see use using page home blog read more click here learn contact us privacy policy terms login sign menu search skip content cookie cookies complete ultimate definitive tips ideas examples everything need know free official welcome index default untitled 2023 2024 2025 2026 2027".split(" ");
export var STOPSET = new Set(STOP);
// ---------- helpers ----------
// The UI plugs its own progress reporting in here.
export var hooks = { log: function () {}, status: function () {}, progress: function () {} };
// stopped: the user pressed Stop. serpChecked: keywords looked up in SearXNG this scan.
export var state = { stopped: false, serpChecked: new Set() };
export function log(m) { hooks.log(m); }
export function status(m) { hooks.status(m); }
export function prog(p) { hooks.progress(p); }
export function host(s) { return String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, ""); }
export function root(s) { return host(s).replace(/^www\./, ""); }
// Calls the hub Worker. A reply that isn't JSON (e.g. Cloudflare's "Worker exceeded CPU"
// page) becomes { ok: false, error } with the real status, instead of a bare "error".
export function api(path) {
  return fetch("/api/cg/" + path).then(function (r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (_) {
        var m = t.match(/<title>([^<]*)<\/title>/i) || t.match(/error code:?\s*(\d+)/i);
        return { ok: false, error: "HTTP " + r.status + (m ? " — " + m[1].trim() : "") };
      }
    });
  }, function (e) { return { ok: false, error: "network: " + e.message }; });
}
export async function pool(items, n, fn) {
  var i = 0, out = [];
  async function worker() { while (i < items.length && !state.stopped) { var k = i++; out[k] = await fn(items[k], k); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
export function normUrl(u) { try { var x = new URL(u); x.hash = ""; return (x.host + x.pathname).replace(/\/$/, "").toLowerCase(); } catch (_) { return String(u).toLowerCase(); } }
export function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
export var junkPath = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|xml|json|ico)(\?|$)|\/(wp-admin|wp-json|cart|checkout|account|login|signin|signup|feed|tag|author)\b|[?&](replytocom|share|utm_)/i;


// ---------- keyword extraction ----------
export function tokens(s) {
  return String(s || "").toLowerCase().replace(/[’']/g, "").split(/[^\p{L}\p{N}]+/u).filter(function (w) { return w && w.length > 1 && !/^\d+$/.test(w); });
}
export function ngrams(toks, n) {
  var out = [];
  for (var i = 0; i + n <= toks.length; i++) {
    var g = toks.slice(i, i + n);
    if (STOPSET.has(g[0]) || STOPSET.has(g[n - 1])) continue;
    if (n === 1 && g[0].length < 3) continue;
    out.push(g.join(" "));
  }
  return out;
}
export function brandTokens(h) { return new Set(tokens(root(h).split(".").slice(0, -1).join(" "))); }
// Scores 1-3 word phrases by where they appear: title and H1 count most, then URL slug, H2s, meta and body text.
export function mainKeywords(p, brand) {
  var score = new Map();
  var slug = "";
  try { slug = decodeURIComponent(new URL(p.finalUrl || p.url).pathname.split("/").filter(Boolean).pop() || "").replace(/\.\w+$/, "").replace(/[-_.]+/g, " "); } catch (_) {}
  var title = String(p.title || "").split(/\s[|–—\-:·]\s/)[0]; // drop "| Brand" suffix
  var fields = [[title, 5], [(p.h1 || []).join(" . "), 5], [slug, 3], [(p.h2 || []).join(" . "), 1.5], [p.description, 1.5], [p.text, 0.3]];
  var strongScore = new Map();
  fields.forEach(function (f) {
    String(f[0] || "").split(/[.!?|•·:;,()\[\]]/).forEach(function (chunk) {
      var t = tokens(chunk);
      [1, 2, 3, 4].forEach(function (n) {
        ngrams(t, n).forEach(function (g) {
          if (g.split(" ").every(function (w) { return brand.has(w) || STOPSET.has(w); })) return;
          var w = f[1] * [0, 1, 2.2, 2.6, 2.8][n];
          score.set(g, (score.get(g) || 0) + w);
          if (f[1] >= 1) strongScore.set(g, true);
        });
      });
    });
  });
  // Only phrases that appear in a strong field (title, H1, slug, H2, meta) can be a page's keyword.
  var strong = Array.from(score.entries()).filter(function (e) { return strongScore.has(e[0]); });
  strong.sort(function (a, b) { return b[1] - a[1]; });
  var picked = [];
  for (var i = 0; i < strong.length && picked.length < 5; i++) {
    var g = strong[i][0];
    if (picked.some(function (q) { return q.indexOf(g) > -1; })) continue;
    picked = picked.filter(function (q) { return g.indexOf(q) === -1; });
    picked.push(g);
  }
  return picked;
}
export function topicOf(p) {
  try {
    var u = new URL(p.finalUrl || p.url), seg = u.pathname.split("/").filter(Boolean);
    var sec = seg.length > 1 ? seg[0] : "(root)";
    return u.host.replace(/^www\./, "") + " › " + sec;
  } catch (_) { return "?"; }
}

// ---------- crawl a site ----------
export async function crawlSite(domain, opts, part) {
  var r = root(domain), site = { domain: r, hosts: [], pages: [], ranked: null };
  var hosts = ["www." + r, r];
  if (opts.useSubs) {
    log("[" + r + "] finding subdomains in certificate logs…");
    var s = await api("subdomains?domain=" + encodeURIComponent(r)).catch(function () { return {}; });
    if (s.subdomains) { hosts = s.subdomains; log("[" + r + "] " + hosts.length + " names found (" + s.source + ")"); }
  }
  hosts = hosts.filter(function (h) { return !/^(mail|smtp|imap|pop|mx|webmail|cpanel|autodiscover|ftp|vpn|ns\d*|dns|localhost|dev|staging|test|admin|api|cdn|static|assets|img|images)\d*\./.test(h) || h === r; });

  // Probe which hosts actually serve HTML (and collapse www/apex duplicates).
  var probes = await pool(hosts.slice(0, 80), 6, function (h) { return api("page?url=" + encodeURIComponent("https://" + h + "/")).catch(function () { return { ok: false }; }); });
  var live = new Map();
  probes.forEach(function (p, i) {
    if (!p || !p.ok) return;
    var fh = new URL(p.finalUrl).host;
    if (!fh.endsWith(r)) return;
    if (!live.has(fh)) live.set(fh, { host: fh, names: [hosts[i]], home: p });
    else live.get(fh).names.push(hosts[i]);
  });
  site.hosts = Array.from(live.values()).slice(0, opts.maxSubs);
  if (!site.hosts.length) {
    probes.slice(0, 3).forEach(function (p, i) { log("[" + r + "] " + hosts[i] + ": " + ((p && p.error) || "no answer")); });
    log("[" + r + "] This site didn't let us in (often bot protection). Paste its article links in step 2 → “Article links to include” and we'll use those.");
    site.refused = true;
  }
  log("[" + r + "] " + site.hosts.length + " live host(s): " + site.hosts.map(function (x) { return x.host; }).join(", "));
  if (!site.hosts.length && !(opts.extra[r] || []).length) return site;

  // robots.txt rules and the full sitemap tree for every live host (one file per request).
  var hostSet = new Set(site.hosts.map(function (H) { return H.host; })), rules = {};
  for (var i = 0; i < site.hosts.length && !state.stopped; i++) {
    var H = site.hosts[i];
    var rb = await api("robots?host=" + encodeURIComponent(H.host)).catch(function () { return { sitemaps: [], disallow: [] }; });
    rules[H.host] = (rb.disallow || []).map(function (rule) {
      return new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    });
    H.sitemapUrls = [];
    var smQ = (rb.sitemaps || []).slice(), smSeen = new Set(), files = 0;
    while (smQ.length && !state.stopped && files < 1000 && H.sitemapUrls.length < opts.maxPages * 3) {
      var sm = smQ.shift(); if (smSeen.has(sm)) continue; smSeen.add(sm); files++;
      var f = await api("sitemapfile?url=" + encodeURIComponent(sm)).catch(function () { return {}; });
      (f.sitemaps || []).forEach(function (x) { smQ.push(x); });
      (f.urls || []).forEach(function (u) { try { if (new URL(u).host === H.host) H.sitemapUrls.push(u); } catch (_) {} });
      if (files % 5 === 0) status("Reading sitemaps of " + H.host + ": " + files + " file(s), " + H.sitemapUrls.length.toLocaleString() + " URLs…");
    }
    H.sitemapFiles = files;
    H.source = H.sitemapUrls.length ? "sitemap + links" : "links";
    log("[" + r + "] " + H.host + ": " + H.sitemapUrls.length.toLocaleString() + " URLs in " + files + " sitemap file(s)");
  }
  var filt = opts.pathFilter;
  var inFolder = function (u) { return !filt.length || filt.some(function (f) { return u.toLowerCase().indexOf(f) > -1; }); };
  var allowed = function (x) { var path = x.pathname + x.search; return !(rules[x.host] || []).some(function (re) { return re.test(path); }); };
  var inScope = function (u) { try { var x = new URL(u); return hostSet.has(x.host) && !junkPath.test(u) && allowed(x); } catch (_) { return false; } };

  var brand = brandTokens(r), budget = opts.maxPages, seen = new Map(), pages = [];
  // Two FIFO queues (breadth-first): pages that belong in the report, and pages outside the
  // folder that are only visited to discover links to folder pages.
  var mainQ = [], transQ = [], mi = 0, ti = 0;
  // Category pages like /blog/prepaid/ often list articles that live at /blog/article-name.
  // Links from a section page that stay under its parent folder (/blog/) belong to the section.
  var parents = filt.map(function (f) { var x = f.replace(/\/+$/, ""), i = x.lastIndexOf("/"); return i > 0 ? x.slice(0, i + 1) : ""; }).filter(Boolean);
  var underParent = function (u) { try { var path = new URL(u).pathname.toLowerCase(); return parents.some(function (pp) { return path.indexOf(pp) === 0 && path.length > pp.length; }); } catch (_) { return false; } };
  var keep = function (e) { return e.fed || e.fromSection || inFolder(e.url); };
  var add = function (u, depth, fed, fromSection) {
    if (!fed && !inScope(u)) return;
    var n = normUrl(u), e = seen.get(n);
    if (e) {
      e.inlinks++;
      if (fromSection && !keep(e)) { e.fromSection = true; mainQ.push(e); }
      return;
    }
    seen.set(n, e = { url: u, depth: depth, inlinks: fed ? 0 : 1, fed: !!fed, fromSection: !!fromSection });
    (keep(e) ? mainQ : transQ).push(e);
  };
  (opts.extra[r] || []).forEach(function (u) { add(u, 0, true); });
  // A home page that robots.txt blocks (or that is otherwise out of scope) is skipped.
site.hosts.forEach(function (H) { add(H.home.finalUrl, 0); var e = seen.get(normUrl(H.home.finalUrl)); if (e) { e.data = H.home; e.inlinks = 0; } });
  if (opts.full) {
    site.hosts.forEach(function (H) {
      filt.forEach(function (f) { if (f.charAt(0) === "/") add("https://" + H.host + f, 1); });
      H.sitemapUrls.forEach(function (u) { var had = seen.has(normUrl(u)); add(u, 1); if (!had && seen.get(normUrl(u))) seen.get(normUrl(u)).inlinks = 0; });
    });
  } else {
    // Quick sample: a few sitemap/home-link URLs per section, no link following.
    var per = Math.max(3, Math.floor(budget / Math.max(1, site.hosts.length)));
    site.hosts.forEach(function (H) {
      var pool0 = (H.sitemapUrls.length ? H.sitemapUrls : (H.home.links || [])).filter(function (u) { return inScope(u) && inFolder(u); });
      var bySec = new Map();
      pool0.forEach(function (u) { var k = topicOf({ url: u }); if (!bySec.has(k)) bySec.set(k, []); bySec.get(k).push(u); });
      var lists = Array.from(bySec.values()), n = 0, k = 0;
      while (n < per - 1 && lists.some(function (l) { return l.length; })) { var l = lists[k++ % lists.length]; if (l.length) { add(l.shift(), 1); n++; } }
    });
  }

  // Politeness: start at 4 pages at a time, drop to 1 when a site starts refusing, creep back up
  // when it recovers. Failed pages are retried (up to 2 more times) at the end of the queue.
  var conc = 4, failedLast = 0, retried = 0, lost = 0, reasons = {};
  var fails = 0, visited = 0, kept = 0, transit = 0, transitBudget = filt.length ? Math.max(200, Math.round(budget / 2)) : 0, t0 = Date.now();
  while (!state.stopped && kept < budget) {
    var batch = [];
    while (batch.length < conc && kept + batch.length < budget) {
      var next = null;
      if (mi < mainQ.length) next = mainQ[mi++];
      else if (opts.full && ti < transQ.length && transit < transitBudget) { next = transQ[ti++]; if (keep(next)) next = null; else transit++; }
      else break;
      if (!next || next.taken) continue;
      next.taken = true; batch.push(next);
    }
    if (!batch.length) break;
    failedLast = 0;
    var got = await Promise.all(batch.map(function (e) { return e.data ? Promise.resolve(e.data) : api("page?url=" + encodeURIComponent(e.url)).catch(function () { return { ok: false, url: e.url }; }); }));
    got.forEach(function (p, i) {
      var e = batch[i]; visited++;
      if (!p || !p.ok) {
        // A pasted link we couldn't open still counts: build it from the link and its title.
        var why = (p && p.error) || "no answer";
        if (!e.fed) {
          failedLast++;
          if ((e.tries || 0) < 2 && !/HTTP 404|HTTP 410|Not HTML|Invalid URL/.test(why)) { e.tries = (e.tries || 0) + 1; e.taken = false; mainQ.push(e); retried++; return; }
          lost++; var key = why.replace(/https?:\S+/g, "").slice(0, 60); reasons[key] = (reasons[key] || 0) + 1;
          if (fails++ < 3) log("[" + r + "] couldn't read " + e.url + ": " + why);
          return;
        }
        p = { ok: true, url: e.url, finalUrl: e.url, title: (opts.titles || {})[e.url] || "", description: "", h1: [], h2: [], h3: [], links: [], fromList: true };
      }
      var fn = normUrl(p.finalUrl);
      if (fn !== normUrl(e.url)) { var o = seen.get(fn); if (o && o !== e && o.done) { o.inlinks += e.inlinks; return; } seen.set(fn, e); }
      e.done = true;
      if (opts.full) { var fromSec = filt.length && inFolder(e.url); (p.links || []).forEach(function (l) { add(l, e.depth + 1, false, fromSec && underParent(l)); }); }
      if (!keep(e) || (!hostSet.has(new URL(p.finalUrl).host) && !e.fed)) return;
      kept++;
      p.host = new URL(p.finalUrl).host; p.fed = e.fed; p.depth = e.depth; p.entry = e;
      p.type = pageType(p);
      // The section pages you chose (e.g. /blog/prepaid/) are listings of articles, not topics.
      if (filt.some(function (f) { try { return new URL(p.finalUrl).pathname.toLowerCase().replace(/\/+$/, "") === f.replace(/\/+$/, ""); } catch (_) { return false; } })) p.type = "listing";
      p.keywords = p.type === "listing" ? [] : mainKeywords(p, brand);
      p.mainKeyword = p.keywords[0] || "";
      p.onPageKeyword = p.mainKeyword; p.keywordSource = p.mainKeyword ? "on-page" : "";
      p.topic = topicOf(p);
      p.indexable = !/noindex/i.test(p.robots || "") && (!p.canonical || (function () { try { return normUrl(new URL(p.canonical, p.finalUrl).toString()) === fn; } catch (_) { return true; } })());
      p.ranks = [];
      p.h2 = (p.h2 || []).slice(0, 15);
      delete p.text; delete p.links; delete p.h3;
      pages.push(p);
    });
    // Adjust speed: many failures -> slow down and pause; clean batch -> speed up again.
    if (failedLast >= Math.max(1, Math.ceil(batch.length / 3))) { conc = Math.max(1, conc - 1); await new Promise(function (ok) { setTimeout(ok, 1500 * (5 - conc)); }); }
    else if (!failedLast && conc < 4) conc++;
    var left = mainQ.length - mi, rate = kept / Math.max(1, (Date.now() - t0) / 1000);
    part(Math.min(1, kept / Math.max(1, Math.min(budget, kept + left))));
    status("Crawling " + r + ": " + kept.toLocaleString() + " kept · " + visited.toLocaleString() + " visited · " + left.toLocaleString() + " queued · " + rate.toFixed(1) + " pages/s" +
      (left ? " · ~" + Math.ceil(Math.min(left, budget - kept) / Math.max(0.1, rate) / 60) + " min left" : ""));
  }
  pages.forEach(function (p) { p.inlinks = p.entry.inlinks; delete p.entry; });
  site.pages = pages;
  if (retried || lost) log("[" + r + "] retried " + retried + " page(s); " + lost + " still failed" + (lost ? " — reasons: " + Object.keys(reasons).map(function (k) { return k + " ×" + reasons[k]; }).join("; ") : ""));
  site.failed = lost; site.failReasons = reasons;
  site.discovered = mainQ.length; site.queuedLeft = mainQ.slice(mi).filter(function (x) { return !x.taken; }).length;
  log("[" + r + "] crawled " + pages.length + " page(s) (" + visited + " visited, " + site.discovered + " found in scope" + (kept >= budget && mainQ.length > mi ? ", state.stopped at the page limit — " + (mainQ.length - mi).toLocaleString() + " more found but not crawled" : "") + ")");
  return site;
}

// Listing pages (blog index, pagination, tags, categories, authors) are crawled for links
// but not treated as topics.
export function pageType(p) {
  var u; try { u = new URL(p.finalUrl); } catch (_) { return "page"; }
  var path = u.pathname.toLowerCase().replace(/\/+$/, "");
  if (/\/(page|p)\/\d+$/.test(path) || /[?&](page|paged|p)=\d+/.test(u.search)) return "listing";
  if (/\/(tag|tags|category|categories|topic|topics|author|authors|archive|archives)(\/|$)/.test(path)) return "listing";
  if (/^\/(blog|blogs|news|articles|resources|insights|learn|posts|knowledge-base|kb|guides)$/.test(path) || path === "") return path === "" ? "home" : "listing";
  if (/\/(blog|blogs|news|articles|posts|insights|guides|learn|resources)\//.test(path + "/") && path.split("/").length > 2) return "article";
  return "page";
}

// ---------- rankings (free sources) ----------
// Search Console export: finds the query/page/clicks/impressions/position columns by name.
export function parseCsv(text) {
  var rows = [], row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === "\t" || c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
}
export function readGsc(text, domain) {
  var rows = parseCsv(text); if (rows.length < 2) return [];
  var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var cq = col(/^(top )?quer|^keyword|^search term/), cp = col(/^(top )?page|landing|^url|^address/), cc = col(/^clicks?/), ci = col(/^impr/), cpos = col(/^(avg\.? |average )?position|^pos/);
  if (cq < 0 || cpos < 0) throw new Error("couldn't find a query and a position column in that CSV");
  var num = function (v) { return parseFloat(String(v || "").replace(/[^\d.,-]/g, "").replace(",", ".")) || 0; };
  return rows.slice(1).map(function (r) {
    return { keyword: String(r[cq] || "").trim().toLowerCase(), url: cp > -1 ? String(r[cp] || "").trim() : "", clicks: cc > -1 ? num(r[cc]) : null,
      volume: ci > -1 ? num(r[ci]) : null, position: Math.round(num(r[cpos]) * 10) / 10, source: "Search Console" };
  }).filter(function (k) { return k.keyword && k.position > 0; });
}

// Asks the user's SearXNG for each keyword and records where every site appears.
export async function serpCheck(sites, opts) {
  var want = [], seenK = new Set(), pushK = function (k) { k = String(k || "").trim().toLowerCase(); if (k && k.split(" ").length > 1 && !seenK.has(k)) { seenK.add(k); want.push(k); } };
  // Competitor topics first (that's where gaps are), then your own pages, best-linked first.
  var byWeight = function (s) { return s.pages.filter(function (p) { return p.mainKeyword && p.type !== "listing"; }).sort(function (a, b) { return (b.inlinks || 0) - (a.inlinks || 0); }); };
  var lists = sites.slice(1).map(byWeight).concat([byWeight(sites[0])]), k = 0;
  while (want.length < opts.serpLimit && lists.some(function (l) { return l.length; })) { var l = lists[k++ % lists.length]; if (l.length) pushK(l.shift().onPageKeyword); }
  log("Checking " + want.length + " keyword(s) in SearXNG…");
  var done = 0, fails = 0;
  await pool(want, 2, async function (kw) {
    if (fails >= 3) return;
    var res = await fetch("/api/cg/serp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instance: opts.searx, q: kw, language: opts.lang, engines: opts.engines, pages: 2 }) })
      .then(function (r) { return r.json(); }).catch(function (e) { return { error: e.message }; });
    done++; status("SearXNG: " + done + "/" + want.length + " keywords checked…"); prog(done / want.length);
    if (res.error) { if (fails++ < 3) log("SearXNG error on “" + kw + "”: " + res.error); if (fails === 3) log("Too many SearXNG errors — stopping the check."); return; }
    state.serpChecked.add(kw);
    sites.forEach(function (s) {
      var hit = (res.results || []).filter(function (x) { try { var h = new URL(x.url).host; return h === s.domain || h.endsWith("." + s.domain); } catch (_) { return false; } })[0];
      if (hit) { s.ranked = s.ranked || []; s.ranked.push({ keyword: kw, position: hit.position, url: hit.url, volume: null, clicks: null, source: "SearXNG" }); }
    });
  });
}

// Maps ranking keywords onto crawled pages; a page's best-ranking keyword becomes its main keyword.
export function attachRanks(site) {
  if (!site.ranked) return;
  site.rankedTotal = site.ranked.length;
  var byUrl = new Map(site.pages.map(function (p) { return [normUrl(p.finalUrl), p]; }));
  site.ranked.forEach(function (k) { var p = byUrl.get(normUrl(k.url)); if (p) p.ranks.push(k); });
  site.pages.forEach(function (p) {
    if (!p.ranks.length) return;
    p.ranks.sort(function (a, b) { return a.position - b.position || (b.volume || 0) - (a.volume || 0); });
    p.mainKeyword = p.ranks[0].keyword; p.keywordSource = p.ranks[0].source;
    p.keywords = [p.mainKeyword].concat(p.keywords.filter(function (k) { return k !== p.mainKeyword; })).slice(0, 5);
  });
}

// ---------- gap analysis ----------
export function keywordGap(you, comps) {
  var mine = new Map(), rows = new Map();
  (you.ranked || []).forEach(function (k) { var c = mine.get(k.keyword); if (!c || k.position < c.position) mine.set(k.keyword, k); });
  comps.forEach(function (c) {
    (c.ranked || []).forEach(function (k) {
      var r = rows.get(k.keyword);
      if (!r) rows.set(k.keyword, r = { keyword: k.keyword, volume: null, comps: {}, best: null });
      var cur = r.comps[c.domain];
      if (!cur || k.position < cur.position) r.comps[c.domain] = { position: k.position, url: k.url };
      if (!r.best || k.position < r.best.position) r.best = { domain: c.domain, position: k.position, url: k.url };
    });
  });
  var out = [];
  rows.forEach(function (r) {
    var m = mine.get(r.keyword);
    // Without a SearXNG check or a GSC row we can't tell whether you rank, so leave such keywords out.
    if (!m && !state.serpChecked.has(r.keyword) && !you.gsc) return;
    r.volume = m && m.volume != null ? m.volume : null;
    r.you = m ? m.position : null; r.yourUrl = m ? m.url : "";
    r.compCount = Object.keys(r.comps).length;
    if (!m) r.status = r.best.position <= 20 ? "missing" : "low";
    else if (m.position > r.best.position + 5 || (m.position > 10 && r.best.position <= 10)) r.status = "weak";
    else r.status = "shared";
    if (r.status !== "low") out.push(r);
  });
  // "unique" needs a SearXNG check, otherwise we don't know competitors are absent.
  mine.forEach(function (k) { if (!rows.has(k.keyword) && state.serpChecked.has(k.keyword)) out.push({ keyword: k.keyword, volume: k.volume, comps: {}, compCount: 0, you: k.position, yourUrl: k.url, best: null, status: "unique" }); });
  // Opportunity: how many competitors rank × how high, plus a bonus when you're absent.
  out.forEach(function (r) { r.opportunity = r.status === "missing" || r.status === "weak" ? Math.round(r.compCount * (21 - Math.min(20, r.best.position)) * (r.status === "missing" ? 1.5 : 1)) : 0; });
  return out.sort(function (a, b) { return b.opportunity - a.opportunity || (b.volume || 0) - (a.volume || 0); });
}
export function stem(w) { return w.replace(/(ies)$/, "y").replace(/(es|s)$/, "").replace(/ing$/, ""); }
export function topicSet(ps) { return ps.filter(function (p) { return p.type !== "listing" && p.type !== "home"; }).map(function (p) { return { p: p, t: new Set(p.keywords.slice(0, 3).join(" ").split(" ").filter(function (w) { return !STOPSET.has(w); }).map(stem)) }; }); }
export function topicGap(you, comps) {
  var mine = topicSet(you.pages), out = [];
  comps.forEach(function (c) {
    topicSet(c.pages).forEach(function (x) {
      if (!x.p.mainKeyword || !x.t.size) return;
      var best = 0, bestP = null;
      mine.forEach(function (m) {
        var inter = 0; x.t.forEach(function (w) { if (m.t.has(w)) inter++; });
        var j = inter / Math.min(x.t.size, m.t.size || 1);
        if (j > best) { best = j; bestP = m.p; }
      });
      var vol = x.p.ranks.filter(function (k) { return k.position <= 20; }).length;
      out.push({ competitor: c.domain, topic: x.p.topic, mainKeyword: x.p.mainKeyword, keywords: x.p.keywords.join(", "), url: x.p.finalUrl, title: x.p.title,
        coverage: best >= 0.67 ? "covered" : best >= 0.34 ? "partial" : "missing", match: bestP ? bestP.finalUrl : "", score: Math.round(best * 100), rankingVolume: vol, rankingCount: x.p.ranks.length });
    });
  });
  return out.sort(function (a, b) { var o = { missing: 0, partial: 1, covered: 2 }; return o[a.coverage] - o[b.coverage] || b.rankingVolume - a.rankingVolume; });
}

// ---------- topic map: clusters pages from every site into shared topics ----------
export function topicMap(R) {
  var clusters = [];
  [R.you].concat(R.comps).forEach(function (s) {
    s.pages.forEach(function (p) {
      if (p.type === "listing" || p.type === "home") return;
      var t = new Set(p.keywords.slice(0, 2).join(" ").split(" ").filter(function (w) { return w && !STOPSET.has(w); }).map(stem));
      if (!t.size) return;
      var best = null, bs = 0;
      clusters.forEach(function (c) {
        var inter = 0; t.forEach(function (w) { if (c.core.has(w)) inter++; });
        var sc = inter / Math.min(t.size, c.core.size);
        if (sc > bs) { bs = sc; best = c; }
      });
      if (!best || bs < 0.6) clusters.push(best = { core: t, pages: [], names: new Map() });
      best.pages.push({ site: s.domain, p: p });
      best.names.set(p.mainKeyword, (best.names.get(p.mainKeyword) || 0) + 1);
    });
  });
  // Brand vocabulary from the profile + knowledge base (stemmed term weights).
  var b = R.brand || {}, vocab = new Map();
  [[b.about, 3], [b.offer, 4], [b.audience, 2], [b.kb, 1]].forEach(function (f) { tokens(f[0]).forEach(function (w) { if (!STOPSET.has(w)) { w = stem(w); vocab.set(w, (vocab.get(w) || 0) + f[1]); } }); });
  var vmax = Math.max(1, Math.max.apply(null, Array.from(vocab.values()).concat([1])));
  var avoid = new Set(tokens(b.avoid).filter(function (w) { return !STOPSET.has(w); }).map(stem));
  var myTopics = topicSet(R.you.pages);
  return clusters.map(function (c) {
    var by = {}; c.pages.forEach(function (x) { (by[x.site] = by[x.site] || []).push(x.p); });
    var compsWith = R.comps.filter(function (cp) { return by[cp.domain]; }).length, you = (by[R.you.domain] || []).length;
    var status = you && compsWith ? (compsWith === R.comps.length ? "everyone" : "shared") : you ? "you only" : compsWith >= 2 ? "gap — shared by competitors" : "gap";
    var label = Array.from(c.names.entries()).sort(function (a, b) { return b[1] - a[1] || a[0].length - b[0].length; })[0][0];
    var ranks = c.pages.reduce(function (n, x) { return n + x.p.ranks.length; }, 0);
    // --- Topic score (0-100) = 40% brand relevance + 25% gap + 20% competitor demand + 15% rankability.
    var words = Array.from(c.core), hit = 0;
    words.forEach(function (w) { if (vocab.has(w)) hit += 0.5 + 0.5 * Math.min(1, vocab.get(w) / (vmax * 0.25)); });
    var relevance = vocab.size ? Math.round(100 * Math.min(1, hit / Math.max(1, words.length) * 1.3)) : 50;
    if (words.some(function (w) { return avoid.has(w); })) relevance = Math.round(relevance * 0.2);
    var near = 0; myTopics.forEach(function (m) { var i = 0; c.core.forEach(function (w) { if (m.t.has(w)) i++; }); near = Math.max(near, i / Math.min(c.core.size, m.t.size || 1)); });
    var gap = you ? 0 : near >= 0.34 ? 55 : 100;
    var demand = Math.round(100 * Math.min(1, (compsWith / Math.max(1, R.comps.length)) * 0.7 + Math.min(1, (c.pages.length - you) / 6) * 0.3));
    var compBest = Infinity; c.pages.forEach(function (x) { if (x.site !== R.you.domain) x.p.ranks.forEach(function (k) { compBest = Math.min(compBest, k.position); }); });
    // Rankable when competitors already rank for it (proven demand) and you have related pages to build on.
    var rankability = Math.round(40 + (near >= 0.34 ? 30 : 0) + (compBest <= 10 ? 30 : compBest <= 20 ? 15 : 0));
    var score = you ? Math.round(relevance * 0.4) : Math.round(relevance * 0.4 + gap * 0.25 + demand * 0.2 + rankability * 0.15);
    c.pages.forEach(function (x) { x.p.cluster = label; });
    return { topic: label, by: by, you: you, compsWith: compsWith, status: status, total: c.pages.length, ranks: ranks,
      keywords: Array.from(c.names.keys()).slice(0, 8).join(", "), relevance: relevance, gap: gap, demand: demand, rankability: rankability, score: score,
      verdict: you ? "covered" : score >= 70 ? "write next" : score >= 50 ? "worth it" : relevance < 35 ? "off-brand" : "low priority" };
  }).sort(function (a, b) { return b.score - a.score || b.compsWith - a.compsWith || b.total - a.total; });
}

