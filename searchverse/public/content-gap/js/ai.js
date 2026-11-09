// Gemini planning (Koray Tuğberk GÜBÜR's topical-authority framework), Google
// Autocomplete checks and SERP snapshots. All calls go through the hub Worker.
import { api, pool } from "./engine.js";

function pageLine(p) {
  var path; try { var u = new URL(p.finalUrl); path = u.host.replace(/^www\./, "") + u.pathname; } catch (_) { path = p.finalUrl; }
  var best = p.ranks && p.ranks[0];
  return "- " + p.mainKeyword + " | " + String(p.title || "").slice(0, 90) + " | " + path + (best ? " | ranks #" + best.position + " for “" + best.keyword + "”" : "");
}

// Builds the planning prompt from the project, the scan report and the scored topics.
export function buildPlanPrompt(project, report, n) {
  var b = project.brand || {}, you = report.you, comps = report.comps;
  var cap = function (a, k) { return a.slice(0, k); };
  var articles = function (s) { return s.pages.filter(function (p) { return p.mainKeyword && p.type !== "listing"; }); };
  var out = [
    "You are a semantic SEO strategist who builds topical maps with Koray Tuğberk GÜBÜR's topical authority framework.",
    "Framework reminders: the SOURCE CONTEXT is how the brand makes money and why it publishes; the CENTRAL ENTITY is the main thing the site is about;",
    "the CENTRAL SEARCH INTENT unites the two. The CORE SECTION holds topics closest to the source context (the money topics: the entity's attributes that",
    "relate directly to what the brand sells). The OUTER SECTION holds supporting topics that build topical authority and link back to the core.",
    "Every topic is an attribute or sub-entity of the central entity, has one representative search query, a search intent, and a contextual bridge (which core page it should link to).",
    "", "## Brand",
    "Name: " + (b.name || project.domain), "Website: " + project.domain,
    "What it does: " + (b.about || "(not given — infer from its pages)"), "Audience: " + (b.audience || "(not given)"),
    "Products / services: " + (b.offer || "(not given)"), "Never write about: " + (b.avoid || "nothing listed"),
    "Knowledge base:\n" + (b.kb ? b.kb.slice(0, 30000) : "(not given)"),
    "", "## Competitors",
  ].concat((project.competitors || []).map(function (c) { return "- " + c.domain + (c.niche ? " — niche: " + c.niche : ""); }));
  out.push("", "## Pages the brand already has (main keyword | title | url | ranking)");
  out = out.concat(cap(articles(you), 400).map(pageLine));
  comps.forEach(function (c) {
    var ps = articles(c).sort(function (a, b) { return (b.inlinks || 0) - (a.inlinks || 0); });
    out.push("", "## " + c.domain + " pages (most internally linked first)"); out = out.concat(cap(ps, 250).map(pageLine));
  });
  var gaps = report.topics.filter(function (t) { return !t.you && t.verdict !== "off-brand"; });
  if (gaps.length) {
    out.push("", "## Topics competitors cover and the brand doesn't (topic | topic score | brand relevance | competitors covering | pages)");
    out = out.concat(cap(gaps, 200).map(function (t) { return "- " + t.topic + " | " + t.score + " | " + t.relevance + " | " + t.compsWith + "/" + comps.length + " | " + (t.total - t.you); }));
  }
  var kg = (report.kwGap || []).filter(function (r) { return r.status === "missing" || r.status === "weak"; });
  if (kg.length) {
    out.push("", "## Keywords competitors rank for and the brand doesn't (keyword | status | best competitor position)");
    out = out.concat(cap(kg, 150).map(function (r) { return "- " + r.keyword + " | " + r.status + " | #" + (r.best ? r.best.position : "?"); }));
  }
  out.push("", "## Task",
    "1. State the source context, the central entity and the central search intent in one line each.",
    "   Every idea must be a DIFFERENT search intent: merge near-duplicates (e.g. 'best jio prepaid plans' and 'jio recharge plans' are one idea) and skip anything the brand's pages above already cover.",
    "2. Recommend the " + n + " best NEW topics to write (not ones the brand already covers), split into core and outer section.",
    "   Prefer gaps that several competitors cover, that fit the brand's knowledge base, and that the brand can realistically rank for.",
    "3. Score each 0-100: relevance (fit with the source context and knowledge base), rank_potential (can this brand rank, given its existing pages to link from and how competitors cover it), topic_score (overall).",
    "4. primary_keyword: the single most natural query a searcher types. It will be checked against Google Autocomplete.",
    "5. link_to: the brand's existing URL (from the list above) this article should link to, or the core topic it supports.",
    "Order ideas by topic_score, best first. Use only URLs that appear above.",
    "", "Reply with JSON only:",
    '{"source_context":"","central_entity":"","central_search_intent":"","ideas":[{"topic":"","section":"core|outer","attribute":"which attribute of the central entity","primary_keyword":"","secondary_keywords":[""],"search_intent":"informational|commercial|transactional|navigational","content_type":"guide|how-to|comparison|list|definition|landing page|tool","suggested_title":"","why":"1-2 plain sentences","topic_score":0,"relevance":0,"rank_potential":0,"competitor_urls":[""],"link_to":"","outline":["H2 ..."]}]}');
  return out.join("\n");
}

export async function askGemini(key, model, prompt) {
  var res = await fetch("/api/cg/gemini", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key, model: model, prompt: prompt }) })
    .then(function (r) { return r.json(); }).catch(function (e) { return { error: e.message }; });
  if (res.error) throw new Error(res.error);
  var j; try { j = JSON.parse(String(res.text).replace(/^\s*```(json)?|```\s*$/g, "")); } catch (_) { throw new Error("Gemini's reply wasn't valid JSON — try again."); }
  if (!j || !Array.isArray(j.ideas)) throw new Error("Gemini didn't return any ideas — try again.");
  j.ideas.sort(function (a, b) { return (b.topic_score || 0) - (a.topic_score || 0); });
  return j;
}

// Marks each idea with whether Google Autocomplete knows its primary keyword.
export async function checkAutocomplete(ideas, lang, gl) {
  await pool(ideas, 3, async function (it) {
    var kw = String(it.primary_keyword || "").toLowerCase().trim(); if (!kw) return;
    var res = await api("suggest?q=" + encodeURIComponent(kw) + "&hl=" + encodeURIComponent(lang || "en") + "&gl=" + encodeURIComponent(gl || "us")).catch(function () { return {}; });
    if (!res.suggestions) return;
    var sug = res.suggestions.map(function (x) { return String(x).toLowerCase(); });
    it.autocomplete = sug.indexOf(kw) > -1 ? "exact" : sug.some(function (x) { return x.indexOf(kw) === 0; }) ? "prefix" : sug.length ? "related" : "none";
    it.related = sug.filter(function (x) { return x !== kw; }).slice(0, 8);
  });
  return ideas;
}

// Top results for one query from the user's SearXNG.
export async function serpSnapshot(instance, q, lang, engines) {
  var res = await fetch("/api/cg/serp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instance: instance, q: q, language: lang || "en", engines: engines || "", pages: 1 }) })
    .then(function (r) { return r.json(); }).catch(function (e) { return { error: e.message }; });
  if (res.error) throw new Error(res.error);
  return (res.results || []).slice(0, 10);
}

// ---------------- content briefs ----------------
import { tokens as _tokens, stem as _stem, STOPSET as _STOP } from "./engine.js";

// Meaningful, stemmed words of a phrase ("Best Jio prepaid plans" -> jio, prepaid, plan).
// Reduces word forms to one root: activate / activation / activating / activated -> "activ".
function root(w) {
  w = _stem(w);
  for (const suf of ["ations", "ation", "ating", "ated", "ate", "ions", "ion", "ings", "ing", "ers", "er", "ed", "ly"]) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}
export function wordSet(s) {
  return new Set(_tokens(s).filter((w) => !_STOP.has(w) && w.length > 1).map(root));
}
// How much of the smaller phrase the other one covers (0..1).
export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0; a.forEach((w) => { if (b.has(w)) n++; });
  return n / Math.min(a.size, b.size);
}

// Pages of a site that are about the same thing as `phrase`, best match first.
export function similarPages(pages, phrase, min) {
  const want = wordSet(phrase);
  return pages.filter((p) => p.type !== "listing" && p.type !== "home")
    .map((p) => ({ p, score: Math.max(overlap(want, wordSet(p.mainKeyword)), overlap(want, wordSet((p.keywords || []).slice(0, 3).join(" "))), overlap(want, wordSet(p.title)) * 0.9) }))
    .filter((x) => x.score >= (min || 0.5)).sort((a, b) => b.score - a.score);
}

// Everything a brief needs about one topic, gathered from the scan.
export function briefInputs(report, topic, primary) {
  const comps = [];
  const fromCluster = report.topics.find((t) => t.topic === topic);
  report.comps.forEach((s) => {
    const ps = fromCluster && fromCluster.by[s.domain] ? fromCluster.by[s.domain] : similarPages(s.pages, primary || topic, 0.5).map((x) => x.p);
    ps.slice(0, 4).forEach((p) => comps.push({ site: s.domain, url: p.finalUrl, title: p.title, h1: (p.h1 || [])[0] || "", h2: p.h2 || [], words: p.words || 0, ranks: (p.ranks || []).slice(0, 5) }));
  });
  const same = similarPages(report.you.pages, primary || topic, 0.67).slice(0, 3).map((x) => ({ url: x.p.finalUrl, title: x.p.title, score: Math.round(x.score * 100) }));
  const related = similarPages(report.you.pages, topic + " " + (primary || ""), 0.34).slice(0, 8).map((x) => ({ url: x.p.finalUrl, title: x.p.title }));
  return { comps: comps.slice(0, 12), same, related };
}

export function buildBriefPrompt(project, topic, primary, inputs, suggestions) {
  const b = project.brand || {};
  const out = [
    "You are a senior SEO content strategist. Write a detailed content brief for ONE article for the brand below.",
    "Follow Koray Tuğberk GÜBÜR's semantic SEO approach: cover the topic's attributes completely, answer the questions behind the query, and connect the article to the brand's source context.",
    "", "## Brand", "Name: " + (b.name || project.domain), "Website: " + project.domain, "What it does: " + (b.about || ""), "Audience: " + (b.audience || ""),
    "Products / services: " + (b.offer || ""), "Never write about: " + (b.avoid || "nothing listed"), "Knowledge base:\n" + (b.kb ? b.kb.slice(0, 15000) : "(none)"),
    "", "## Topic", "Topic: " + topic, "Suggested primary keyword: " + (primary || topic),
    "Google Autocomplete for it: " + (suggestions && suggestions.length ? suggestions.join("; ") : "(none)"),
    "", "## Brand pages that may already cover it (possible duplicates)",
  ].concat(inputs.same.length ? inputs.same.map((x) => `- ${x.title} | ${x.url} | ${x.score}% match`) : ["- none"]);
  out.push("", "## Brand pages to link from / to");
  out.push(...(inputs.related.length ? inputs.related.map((x) => `- ${x.title} | ${x.url}`) : ["- none"]));
  out.push("", "## Competitor pages on this topic (title | words | headings)");
  inputs.comps.forEach((c) => out.push(`- [${c.site}] ${c.title} | ${c.words || "?"} words | ${c.url}`, "  H2s: " + (c.h2.length ? c.h2.join(" / ") : "(not captured)")));
  if (!inputs.comps.length) out.push("- none captured");
  out.push("", "## Instructions",
    "- First decide if this is really the SAME topic as one of the brand's existing pages. If so, set same_as_existing.is_duplicate true and recommend updating that page instead.",
    "- Pick ONE primary keyword (a query real people type). Then 5-12 secondary keywords, each with where to use it: title, h1, h2, body, faq, meta or slug.",
    "- Give a complete H2/H3 structure that beats the competitors: cover everything they cover, plus what they miss. Add a one-line note per H2 on what to write.",
    "- word_count_target: based on the competitor word counts (a bit above the median), as a number.",
    "- internal_links: only URLs from the brand pages listed above.",
    "- eeat: concrete, article-specific actions for Google's E-E-A-T. experience = first-hand proof (real screenshots, tested steps, customer examples from the brand); expertise = who writes/reviews it and what credentials to show; authoritativeness = official sources, data and citations to reference, brand facts; trust = accuracy, dates, prices/terms disclosure, update date, contact/support info. 2-4 items each.",
    "", "Reply with JSON only:",
    '{"same_as_existing":{"is_duplicate":false,"url":"","note":""},"primary_keyword":"","search_intent":"informational|commercial|transactional|navigational","audience_angle":"","title_tag":"","meta_description":"","h1":"","url_slug":"","word_count_target":0,"keywords":[{"keyword":"","role":"primary|secondary|supporting","use_in":["title","h1","h2","body","faq","meta","slug"],"why":""}],"structure":[{"h2":"","h3":[""],"note":""}],"faqs":[""],"internal_links":[{"anchor":"","url":""}],"must_cover":[""],"beat_competitors":"","cta":"","eeat":{"experience":[""],"expertise":[""],"authoritativeness":[""],"trust":[""]}}');
  return out.join("\n");
}

// A brief without AI: built from competitor headings, the topic's keywords and Autocomplete.
export function localBrief(project, topic, primary, inputs, suggestions, extraKeywords) {
  const kw = (primary || topic).toLowerCase();
  const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  // Most common competitor H2s, merging near-duplicates.
  const heads = [];
  inputs.comps.forEach((c) => c.h2.forEach((h) => {
    const ws = wordSet(h); if (!ws.size || h.length > 90) return;
    const hit = heads.find((x) => overlap(x.ws, ws) >= 0.67);
    if (hit) hit.n++; else heads.push({ h, ws, n: 1 });
  }));
  heads.sort((a, b) => b.n - a.n);
  const words = inputs.comps.map((c) => c.words).filter((n) => n > 100).sort((a, b) => a - b);
  const median = words.length ? words[Math.floor(words.length / 2)] : 0;
  const secondary = Array.from(new Set((extraKeywords || []).concat(suggestions || []).map((x) => String(x).toLowerCase().trim()).filter((x) => x && x !== kw))).slice(0, 10);
  const questions = (suggestions || []).filter((s) => /^(how|what|why|which|when|can|is|does|do|where)\b/i.test(s));
  return {
    local: true,
    same_as_existing: inputs.same.length ? { is_duplicate: inputs.same[0].score >= 80, url: inputs.same[0].url, note: `Your page “${inputs.same[0].title}” matches ${inputs.same[0].score}% — consider updating it instead of writing a new one.` } : { is_duplicate: false },
    primary_keyword: kw, search_intent: /\b(buy|price|plan|plans|recharge|offer|best|vs|compare)\b/.test(kw) ? "commercial" : "informational",
    title_tag: cap(kw) + " | " + ((project.brand || {}).name || project.domain), meta_description: "", h1: cap(kw),
    url_slug: "/" + kw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "/", word_count_target: median ? Math.round(median * 1.1 / 50) * 50 : 0,
    keywords: [{ keyword: kw, role: "primary", use_in: ["title", "h1", "slug", "meta", "body"], why: "Main query for this topic" }]
      .concat(secondary.map((k) => ({ keyword: k, role: "secondary", use_in: questions.includes(k) ? ["faq", "h2"] : ["h2", "body"], why: suggestions && suggestions.includes(k) ? "People search this on Google" : "Competitors use it on this topic" }))),
    structure: heads.slice(0, 10).map((x) => ({ h2: x.h, h3: [], note: `${x.n} competitor page(s) cover this` })),
    faqs: questions.slice(0, 6), internal_links: inputs.related.slice(0, 5).map((x) => ({ anchor: x.title, url: x.url })),
    eeat: {
      experience: ["Add real screenshots of the steps on your own " + ((project.brand || {}).name || "brand") + " product or app", "Include a worked example or a real customer scenario"],
      expertise: ["Show the author's name, role and why they know this topic", "Have a subject expert review it and say so"],
      authoritativeness: ["Cite official sources and data (regulators, official docs, your own published numbers)", "Link to your related product or help pages"],
      trust: ["Show the last-updated date and keep prices, plans and terms current", "State any conditions clearly and add where to get help"],
    },
    must_cover: [], beat_competitors: heads.length ? "Cover every heading above, then add what none of them answer." : "No competitor headings captured — re-scan to collect them.",
  };
}
