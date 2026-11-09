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
