// Topic Planner app: projects → 5-step setup → scan → results. Hash routes:
//   #/                     projects
//   #/new                  new project (step 1)
//   #/p/:id/edit/:step     setup wizard
//   #/p/:id/scan           scan in progress
//   #/p/:id[/:tab]         results dashboard
//   #/settings             workspace key and API keys
import * as E from "./engine.js";
import { buildPlanPrompt, askGemini, checkAutocomplete, serpSnapshot } from "./ai.js";
import { $, $$, esc, link, pill, num, scoreBar, scoreRing, toast, table, db, workspaceKey, setWorkspaceKey, local, download, toCsv } from "./ui.js";

const view = $("#view");
const crumbs = $("#crumbs");
let draft = null;          // project being edited in the wizard
let pendingGsc = null;     // Search Console rows chosen for the next scan
let scan = null;           // the scan in progress, if any
const cache = {};          // project id -> { project, report, backlog, changes, summary }

const STEP_NAMES = ["Your brand", "Competitors", "What to scan", "Power-ups", "Ready!"];
const DEFAULT_SCAN = { mode: "full", folder: "/blog/", maxPages: 2000, maxSubs: 15, useSubs: false, yourUrls: "", compUrls: "" };
const DEFAULT_POWER = { searx: "", engines: "google", serpLimit: 80, lang: "en", gl: "us", nIdeas: 15, model: "gemini-2.5-flash" };

// "https://www.att.com/blog/" -> { domain: "att.com", folder: "/blog/" }
function splitLink(raw) {
  const t = String(raw || "").trim(); let folder = "";
  try { const u = new URL(/^https?:\/\//i.test(t) ? t : "https://" + t); folder = u.pathname === "/" ? "" : u.pathname.toLowerCase(); } catch (_) {}
  return { domain: E.root(t), folder };
}
// One or more sections, comma or new line separated; full links are reduced to their path.
const cleanFolder = (f) => String(f || "").split(/[,\n]+/).map((x) => {
  x = x.trim().toLowerCase(); if (/^https?:/.test(x) || /^www\./.test(x)) x = splitLink(x).folder;
  return x && x[0] !== "/" ? "/" + x : x;
}).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
const folderList = (f) => String(f || "").split(",").map((x) => x.trim()).filter(Boolean);
const newId = () => Math.random().toString(36).slice(2, 10);
const when = (t) => t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const plural = (n, w) => n.toLocaleString() + " " + w + (n === 1 ? "" : "s");
const explain = (html) => `<div class="explain"><div>${html}</div></div>`;
const setCrumbs = (html) => { crumbs.innerHTML = html || ""; };

// ---------------- router ----------------
async function route() {
  const h = location.hash || "#/";
  let m;
  try {
    if (h === "#/" || h === "#") return await home();
    if (h === "#/settings") return settings();
    if (h === "#/new") return wizard(null, 1);
    if ((m = h.match(/^#\/p\/([\w-]+)\/edit(?:\/(\d))?$/))) return await wizard(m[1], +(m[2] || 1));
    if ((m = h.match(/^#\/p\/([\w-]+)\/scan$/))) return await scanView(m[1]);
    if ((m = h.match(/^#\/p\/([\w-]+)(?:\/([\w-]+))?$/))) return await dashboard(m[1], m[2] || "next");
    location.hash = "#/";
  } catch (e) {
    view.innerHTML = `<div class="card emptybig"><b>😕</b>Something went wrong: ${esc(e.message)}<br><br><a class="btn" href="#/">Back to projects</a></div>`;
  }
}
window.addEventListener("hashchange", route);

// ---------------- projects ----------------
async function home() {
  setCrumbs("");
  view.innerHTML = `<h1>Your <span class="grad">projects</span></h1>
    <p class="lead">One project per brand. Each project remembers your competitors, every scan, and your list of topics to write.</p>
    <div class="cards" id="plist" style="margin-top:24px"><div class="card muted">Loading…</div></div>`;
  let list;
  try { list = await db("projects"); }
  catch (e) {
    $("#plist").innerHTML = `<div class="card" style="grid-column:1/-1"><h3>Can't reach the project database</h3><p class="muted" style="margin-top:6px">${esc(e.message)}</p></div>`;
    return;
  }
  $("#plist").innerHTML = `<a class="card newproj" href="#/new"><div><b>＋</b>New project<br><small>Takes about 3 minutes to set up</small></div></a>` +
    list.map((p) => `<a class="card proj" href="#/p/${esc(p.id)}">
      <div class="ic">📁</div><h3>${esc(p.name)}</h3><div class="muted">${esc(p.domain)}</div>
      <div class="meta">${pill(plural((p.competitors || []).length, "competitor"))}${pill(p.scans ? plural(p.scans, "scan") : "not scanned yet", p.scans ? "" : "mid")}${p.gaps ? pill(plural(p.gaps, "topic") + " to write", "low") : ""}</div>
      <div class="muted" style="font-size:12px;margin-top:10px">${p.last_scan ? "Last scan " + when(p.last_scan) : "Created " + when(p.updated_at)}</div>
      <button type="button" class="pdel" data-del="${esc(p.id)}" title="Delete this project">🗑️ Delete</button></a>`).join("");
  $$("[data-del]").forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const p = list.find((x) => x.id === b.dataset.del);
      deleteProject(p, () => home());
    };
  });
}

// Asks for confirmation (typing the project name), then deletes the project and all its scans.
async function deleteProject(p, after) {
  const typed = prompt(`Delete “${p.name}”?\n\nThis removes the project, every scan and your topic list. It can't be undone.\n\nType the project name to confirm:`);
  if (typed == null) return;
  if (typed.trim().toLowerCase() !== String(p.name).trim().toLowerCase()) { toast("The name didn't match — nothing was deleted.", true); return; }
  try { await db("projects/" + encodeURIComponent(p.id), "DELETE"); delete cache[p.id]; if (draft && draft.id === p.id) draft = null; toast(`“${p.name}” deleted`); after(); }
  catch (err) { toast("Couldn't delete: " + err.message, true); }
}

// ---------------- settings ----------------
function settings() {
  setCrumbs(`/ <a href="#/">Projects</a> / Settings`);
  view.innerHTML = `<h1>Settings</h1>
    <div class="card" style="margin-top:20px;max-width:760px">
      <h3>🔑 Workspace key</h3>
      <p class="muted" style="margin:6px 0 12px">This key opens your projects. It lives in this browser. Copy it somewhere safe; paste it on another computer to see the same projects. Anyone with the key can see and change them.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="wsk" value="${esc(workspaceKey())}" style="flex:1;min-width:260px;font-family:ui-monospace,monospace">
        <button class="btn sm" id="wskCopy">Copy</button><button class="btn sm" id="wskSave">Use this key</button></div>
    </div>
    <div class="card" style="margin-top:16px;max-width:760px">
      <h3>✨ Gemini API key <span class="tag free">free tier</span></h3>
      <p class="muted" style="margin:6px 0 12px">Lets the AI build your topical map and pick topics. Get one free at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Saved only in this browser; it's sent straight to Google when you ask for a plan.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="gem" type="password" value="${esc(local("gemKey") || "")}" placeholder="Paste your Gemini key" style="flex:1;min-width:260px"><button class="btn sm" id="gemSave">Save</button></div>
    </div>`;
  $("#wskCopy").onclick = () => { navigator.clipboard.writeText($("#wsk").value).then(() => toast("Copied")); };
  $("#wskSave").onclick = () => { const k = $("#wsk").value.trim(); if (k.length < 16) return toast("The key needs at least 16 characters.", true); setWorkspaceKey(k); toast("Workspace key saved"); };
  $("#gemSave").onclick = () => { local("gemKey", $("#gem").value.trim()); toast("Gemini key saved in this browser"); };
}

// ---------------- setup wizard ----------------
async function wizard(id, step) {
  if (!id) { if (!draft || draft.id) draft = { brand: {}, competitors: [{ domain: "", niche: "" }], scan: { ...DEFAULT_SCAN }, power: { ...DEFAULT_POWER } }; }
  else if (!draft || draft.id !== id) {
    const p = await db("projects/" + encodeURIComponent(id));
    draft = { ...p, brand: p.brand || {}, competitors: p.competitors && p.competitors.length ? p.competitors : [{ domain: "", niche: "" }], scan: { ...DEFAULT_SCAN, ...(p.scan || {}) }, power: { ...DEFAULT_POWER, ...(p.power || {}) } };
  }
  step = Math.max(1, Math.min(5, step));
  setCrumbs(`/ <a href="#/">Projects</a> / ${draft.id ? `<a href="#/p/${esc(draft.id)}">${esc(draft.name)}</a> / Edit` : "New project"}`);
  const body = [null, stepBrand, stepCompetitors, stepScope, stepPower, stepReview][step]();
  view.innerHTML = `<div class="wiz">
    <h1>${draft.id ? "Edit <span class=grad>" + esc(draft.name) + "</span>" : "Let's set up your <span class=grad>project</span>"}</h1>
    <div class="steps">${STEP_NAMES.map((n, i) => `<div class="step ${i + 1 === step ? "on" : i + 1 < step ? "done" : ""}" data-go="${i + 1}"><b>${i + 1 < step ? "✓" : i + 1}</b>${n}</div>`).join("")}</div>
    <div class="card">${body}</div>
    <div class="wiz-foot">
      ${step > 1 ? `<button class="btn ghost" id="back">‹ Back</button>` : `<a class="btn ghost" href="#/">Cancel</a>`}
      <span class="grow"></span>
      ${step < 5 ? `<button class="btn primary" id="next">Next: ${STEP_NAMES[step]} ›</button>` : `<button class="btn" id="saveOnly">Save project</button><button class="btn primary" id="startScan">🚀 Save &amp; start the scan</button>`}
    </div></div>`;
  wireStep(step);
  const go = async (to) => { if (to > step && !(await collect(step))) return; if (to < step) await collect(step, true); location.hash = draft.id ? `#/p/${draft.id}/edit/${to}` : (to === 1 ? "#/new" : location.hash); if (!draft.id) wizard(null, to); };
  $$(".step").forEach((s) => { s.onclick = () => go(+s.dataset.go); });
  if ($("#back")) $("#back").onclick = () => go(step - 1);
  if ($("#next")) $("#next").onclick = () => go(step + 1);
  if ($("#saveOnly")) $("#saveOnly").onclick = async () => { if (await saveDraft()) location.hash = `#/p/${draft.id}`; };
  if ($("#startScan")) $("#startScan").onclick = async () => { if (await saveDraft()) location.hash = `#/p/${draft.id}/scan`; };
}

function field(id, label, hint, value, opts = {}) {
  const input = opts.area
    ? `<textarea id="${id}" placeholder="${esc(opts.ph || "")}" ${opts.tall ? 'style="min-height:150px"' : ""}>${esc(value || "")}</textarea>`
    : `<input id="${id}" type="${opts.type || "text"}" value="${esc(value == null ? "" : value)}" placeholder="${esc(opts.ph || "")}" ${opts.attrs || ""}>`;
  return `<div class="field"><label class="f" for="${id}">${label}</label>${hint ? `<span class="hint">${hint}</span>` : ""}${input}</div>`;
}

function stepBrand() {
  const b = draft.brand;
  return `<h2>👋 Tell us about your brand</h2>
    ${explain("We use this to judge which topics fit <b>you</b>. The more you write, the smarter the topic scores get. Simple sentences are perfect.")}
    <div class="grid2">
      ${field("bName", "Brand name", "What people call you.", b.name || draft.name, { ph: "e.g. Acme" })}
      ${field("bDomain", "Your website", "Just the address — or paste your blog link and we'll split it.", draft.domain, { ph: "e.g. acme.com" })}
    </div>
    ${field("bFolder", "Only read these sections of your site (optional)", "One section, or several separated by commas — paths or full links both work, e.g. <code>/blog/broadband/, /blog/prepaid/</code>. Leave empty to read your whole website.", draft.scan.yourFolder, { area: 1, ph: "/blog/broadband/, /blog/prepaid/, /blog/postpaid/" })}
    ${field("bAbout", "What do you do?", "One or two sentences, like you'd tell a friend.", b.about, { area: 1, ph: "e.g. We make simple CRM software that helps small sales teams keep track of their customers." })}
    <div class="grid2">
      ${field("bAudience", "Who is it for?", "Your ideal customer.", b.audience, { ph: "e.g. founders of 5–50 person B2B startups" })}
      ${field("bAvoid", "Topics you never write about (optional)", "We'll push these to the bottom.", b.avoid, { ph: "e.g. enterprise, medical advice" })}
    </div>
    ${field("bOffer", "Your main products or services", "One per line. These become your “core” topics.", b.offer, { area: 1, ph: "CRM\nLead scoring\nEmail outreach" })}
    ${field("bKb", "Anything else about your brand (optional)", "Paste product pages, FAQs, USPs, case studies — the knowledge base the AI and the scores learn from.", b.kb, { area: 1, tall: 1, ph: "Paste as much as you like." })}`;
}

function stepCompetitors() {
  return `<h2>🥊 Who are your competitors?</h2>
    ${explain("Add each competitor on its own line, with its <b>niche</b> — what it's known for. Want only their blog? Paste the blog link (like <code>https://www.att.com/blog/</code>) and we'll fill in the <b>section</b> for you. Leave the section empty to read the whole website. Up to 8.")}
    <div class="comp-head"><span>#</span><span>Website or blog link</span><span>Section(s) (optional, comma-separated)</span><span>Niche (what they focus on)</span><span></span></div>
    <div id="comps">${draft.competitors.map(compRow).join("")}</div>
    <button class="btn sm" id="addComp" type="button">＋ Add another competitor</button>
    <details style="margin-top:22px" ${draft.scan.compUrls ? "open" : ""}><summary class="muted" style="cursor:pointer">Article links to include (optional) — use this for sites that don't let us in</summary>
      <div style="margin-top:12px">${field("compUrls", "Competitor article links", "One per line, optionally with its title after a <code>|</code>. We always include these. If a site blocks automated visits, we build its topics from these links and titles. Collect them in your own browser — e.g. from their blog page or their public sitemap.", draft.scan.compUrls, { area: 1, tall: 1, ph: "https://www.att.com/blog/what-is-esim/ | What is an eSIM?\nhttps://www.jio.com/jiostories/best-prepaid-plans | Best prepaid plans" })}</div>
    </details>`;
}
const compRow = (c, i) => `<div class="comp-row"><span class="no">${i + 1}</span>
  <input class="cDomain" value="${esc(c.domain)}" placeholder="competitor.com or its blog link" aria-label="Competitor website">
  <input class="cFolder" value="${esc(c.folder || "")}" placeholder="whole site" aria-label="Section to read">
  <input class="cNiche" value="${esc(c.niche || "")}" placeholder="e.g. CRM for startups" aria-label="Competitor niche">
  <button type="button" class="cDel" title="Remove">✕</button></div>`;

// The websites in this project, with the section (folders) each one reads.
function sectionSites() {
  return [{ domain: draft.domain, folder: draft.scan.yourFolder, isYou: true }].concat(draft.competitors.filter((c) => c.domain).map((c) => ({ domain: c.domain, folder: c.folder })));
}
function setSiteFolder(x, folder) {
  if (x.isYou) draft.scan.yourFolder = folder;
  else { const c = draft.competitors.find((c) => c.domain === x.domain); if (c) c.folder = folder; }
}

// Reads a site's sitemaps and home-page links and groups the URLs into folders.
async function detectSections(domain) {
  const urls = new Set(), host = "www." + domain;
  const home = await E.api("page?url=" + encodeURIComponent("https://" + host + "/")).catch(() => ({}));
  if (!home.ok) {
    const bare = await E.api("page?url=" + encodeURIComponent("https://" + domain + "/")).catch(() => ({}));
    if (!bare.ok) throw new Error("This site didn't let us in (" + (home.error || bare.error || "no answer") + "). Type its sections by hand, or paste article links in step 2.");
    Object.assign(home, bare);
  }
  (home.links || []).forEach((u) => urls.add(u));
  const realHost = new URL(home.finalUrl).host;
  const rb = await E.api("robots?host=" + encodeURIComponent(realHost)).catch(() => ({ sitemaps: [] }));
  const queue = (rb.sitemaps || []).slice(), seen = new Set(); let files = 0;
  while (queue.length && files < 25 && urls.size < 40000) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm); files++;
    const f = await E.api("sitemapfile?url=" + encodeURIComponent(sm)).catch(() => ({}));
    (f.sitemaps || []).forEach((x) => queue.push(x)); (f.urls || []).forEach((u) => urls.add(u));
  }
  // Count pages per folder (1 and 2 levels deep). A URL ending in "/" is itself a folder page.
  const groups = new Map(), bump = (k, isPage) => { const g = groups.get(k) || { path: k, pages: 0, listing: false }; if (isPage) g.pages++; else g.listing = true; groups.set(k, g); };
  urls.forEach((u) => {
    let x; try { x = new URL(u); } catch (_) { return; }
    if (x.host.replace(/^www\./, "") !== domain.replace(/^www\./, "")) return;
    const seg = x.pathname.toLowerCase().split("/").filter(Boolean);
    if (seg.length >= 2) bump("/" + seg[0] + "/", true);
    if (seg.length >= 3) bump("/" + seg[0] + "/" + seg[1] + "/", true);
    if (x.pathname.endsWith("/") && seg.length >= 1 && seg.length <= 2) bump("/" + seg.join("/") + "/", false);
  });
  const list = Array.from(groups.values()).filter((g) => g.pages >= 2 || g.listing)
    .sort((a, b) => a.path.split("/")[1].localeCompare(b.path.split("/")[1]) || a.path.length - b.path.length || b.pages - a.pages);
  return { files, total: urls.size, groups: list.slice(0, 120) };
}

function stepScope() {
  const s = draft.scan;
  const minutes = (n) => Math.max(1, Math.round(n / 3 / 60));
  return `<h2>🔍 What should we read?</h2>
    ${explain("We start on each home page and follow every link (and every sitemap), just like Google does, until we've seen the whole site or hit your page limit. Below: which part of each website we'll read. Click <b>🔎 Find sections</b> to see a site's folders and tick the ones you want.")}
    <div class="secbox">${sectionSites().map((x, i) => `<div class="secsite" data-i="${i}">
      <div class="sechead"><b>${esc(x.domain)}</b>${x.isYou ? " " + pill("you", "blue") : ""}<span class="secnow muted">${x.folder ? esc(x.folder) : "whole website"}</span>
        <span class="grow"></span><button type="button" class="btn sm" data-find="${i}">🔎 Find sections</button></div>
      <div class="secfound"></div></div>`).join("")}</div>
    <div class="choice">
      <label><input type="radio" name="mode" value="full" ${s.mode === "full" ? "checked" : ""}><span class="em">🌍</span><b>The whole website</b><small>Every page we can find. Best for a full picture.</small></label>
      <label><input type="radio" name="mode" value="folder" ${s.mode === "folder" ? "checked" : ""}><span class="em">📂</span><b>Same folder on every site</b><small>e.g. /blog on all of them. Sites with their own section (steps 1–2) keep theirs.</small></label>
      <label><input type="radio" name="mode" value="sample" ${s.mode === "sample" ? "checked" : ""}><span class="em">⚡</span><b>A quick look</b><small>A small sample from each section. Good for a first try.</small></label>
    </div>
    <div id="folderBox" ${s.mode === "folder" ? "" : "hidden"}>${field("folder", "Which folder?", "The part of the address after the domain. Separate several with commas.", s.folder, { ph: "/blog/" })}</div>
    <div class="grid2">
      ${field("maxPages", "Most pages to read per website", `About 3 pages a second, so 2,000 pages ≈ <span id="mins">${minutes(s.maxPages)}</span> min per site.`, s.maxPages, { type: "number", attrs: 'min="20" max="50000" step="100"' })}
      ${field("maxSubs", "Most subdomains per website", "Like blog.site.com or help.site.com.", s.maxSubs, { type: "number", attrs: 'min="1" max="60"' })}
    </div>
    <label class="hint" style="color:var(--text);display:flex;gap:8px;align-items:center;margin-bottom:18px"><input type="checkbox" id="useSubs" ${s.useSubs ? "checked" : ""}> Also find and read subdomains (blog.site.com, help.site.com…)</label>
    ${field("yourUrls", "Pages of yours we must include (optional)", "One link per line, e.g. new posts that aren't linked anywhere yet.", s.yourUrls, { area: 1, ph: "https://yoursite.com/blog/new-post" })}`;
}

function stepPower() {
  const p = draft.power;
  return `<h2>⚡ Power-ups <span class="muted" style="font-size:15px;font-weight:500">(all optional, all free)</span></h2>
    ${explain("You can skip this whole step. Each power-up makes the results smarter.")}
    <div class="power"><h3>✨ AI topic planner <span class="tag free">free tier</span></h3>
      <p class="hint">Google's Gemini reads everything we found and builds your topical map with Koray's framework: core topics, supporting topics, and the exact keyword for each.</p>
      <div class="grid2">${field("gemKey", "Gemini API key", 'Free at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Stays in this browser.', local("gemKey") || "", { type: "password", ph: "Paste your key" })}
      ${field("nIdeas", "How many topic ideas?", "", p.nIdeas, { type: "number", attrs: 'min="3" max="40"' })}</div>
      <details><summary class="muted" style="cursor:pointer;font-size:13px">Model</summary><div style="margin-top:10px">${field("model", "Gemini model", "", p.model)}</div></details>
    </div>
    <div class="power"><h3>📈 Your Google rankings <span class="tag free">free</span></h3>
      <p class="hint">Upload a Google Search Console export (query, page, clicks, impressions, position). Only works for your own site — Google never shares competitors' data. Get it with the free “Search Analytics for Sheets” add-on or Looker Studio.</p>
      <input type="file" id="gscFile" accept=".csv,text/csv"><span class="hint" id="gscInfo" style="margin-top:6px">${pendingGsc ? plural(pendingGsc.length, "row") + " ready for the next scan" : ""}</span>
    </div>
    <div class="power"><h3>🏁 Competitor rankings <span class="tag free">free, open source</span></h3>
      <p class="hint">Run your own <a href="https://github.com/searxng/searxng" target="_blank" rel="noopener">SearXNG</a> (one Docker command, turn on the <code>json</code> format). We search each topic and note who's in the top 20 — the free way to see who ranks for what.</p>
      <div class="grid2">${field("searx", "SearXNG address", "", p.searx, { ph: "https://searx.yourdomain.com" })}
      ${field("serpLimit", "Topics to look up", "More = slower.", p.serpLimit, { type: "number", attrs: 'min="5" max="500"' })}</div>
      <details><summary class="muted" style="cursor:pointer;font-size:13px">Search settings</summary><div class="grid2" style="margin-top:10px">
        ${field("engines", "Engines", "Blank = your instance's default.", p.engines)}
        ${field("lang", "Language", "", p.lang)}${field("gl", "Country code", "", p.gl, { ph: "us, in, gb…" })}</div></details>
    </div>`;
}

function stepReview() {
  const s = draft.scan, p = draft.power, comps = draft.competitors.filter((c) => c.domain);
  const scope = s.mode === "full" ? "The whole website" : s.mode === "folder" ? "Only " + s.folder : "A quick sample";
  return `<h2>🎉 All set! Here's the plan</h2>
    ${explain("Check everything looks right. You can change any step later — click a step above.")}
    <dl class="recap">
      <dt>Brand</dt><dd><b>${esc(draft.brand.name || draft.domain)}</b> · ${esc(draft.domain)}</dd>
      <dt>What you do</dt><dd>${esc(draft.brand.about || "—")}</dd>
      <dt>Your site</dt><dd>${esc(draft.domain)}${draft.scan.yourFolder ? " → only " + esc(draft.scan.yourFolder) : ""}</dd>
      <dt>Competitors</dt><dd>${comps.map((c) => `${esc(c.domain)}${c.folder ? ` → only ${esc(c.folder)}` : ""}${c.niche ? ` <span class="muted">(${esc(c.niche)})</span>` : ""}`).join("<br>") || "—"}</dd>
      <dt>What we'll read</dt><dd>${esc(scope)} · up to ${Number(s.maxPages).toLocaleString()} pages per site${s.useSubs ? " · with subdomains" : ""}</dd>
      <dt>Power-ups</dt><dd>${[local("gemKey") ? "✨ AI planner" : "", pendingGsc ? "📈 Search Console" : "", p.searx ? "🏁 SearXNG" : ""].filter(Boolean).join(" · ") || "None (that's fine!)"}</dd>
    </dl>`;
}

function wireStep(step) {
  if (step === 2) {
    const redraw = () => { $("#comps").innerHTML = draft.competitors.map(compRow).join(""); wireRows(); };
    const read = () => { draft.competitors = readComps(); };
    // Pasting a full link moves its path into the Section box.
    const wireRows = () => { $$(".comp-row").forEach((r) => { $(".cDomain", r).onchange = () => { const x = splitLink($(".cDomain", r).value); if (x.folder) { $(".cDomain", r).value = x.domain; if (!$(".cFolder", r).value) $(".cFolder", r).value = x.folder; } }; }); wireDel(); };
    const wireDel = () => $$(".cDel").forEach((b, i) => { b.onclick = () => { read(); draft.competitors.splice(i, 1); if (!draft.competitors.length) draft.competitors.push({ domain: "", niche: "" }); redraw(); }; });
    wireRows();
    $("#addComp").onclick = () => { read(); if (draft.competitors.length >= 8) return toast("Up to 8 competitors.", true); draft.competitors.push({ domain: "", niche: "" }); redraw(); $$(".cDomain").pop().focus(); };
  }
  if (step === 3) {
    const sites = sectionSites();
    $$("[data-find]").forEach((btn) => { btn.onclick = async () => {
      const i = +btn.dataset.find, x = sites[i], box = $(`.secsite[data-i="${i}"] .secfound`), now = $(`.secsite[data-i="${i}"] .secnow`);
      btn.disabled = true; btn.textContent = "Looking…"; box.innerHTML = `<p class="muted">Reading ${esc(x.domain)}'s sitemaps and links…</p>`;
      try {
        const r = await detectSections(x.domain);
        const chosen = new Set(String(x.folder || "").split(",").map((f) => f.trim()).filter(Boolean));
        if (!r.groups.length) { box.innerHTML = `<p class="muted">No folders found (${r.total} links seen). This site will be read as a whole, or type a section in step ${x.isYou ? 1 : 2}.</p>`; return; }
        box.innerHTML = `<p class="muted" style="margin:8px 0">Found ${r.total.toLocaleString()} links in ${r.files} sitemap file(s). Tick the folders to read — none ticked means the whole website.</p>
          <div class="secgrid">${r.groups.map((g) => `<label class="seci ${g.path.split("/").length > 3 ? "sub" : ""}"><input type="checkbox" value="${esc(g.path)}" ${chosen.has(g.path) ? "checked" : ""}> <code>${esc(g.path)}</code> <span class="muted">${g.pages ? g.pages.toLocaleString() + " pages" : "category page"}</span></label>`).join("")}</div>`;
        $$("input[type=checkbox]", box).forEach((cb) => { cb.onchange = () => {
          const picked = $$("input:checked", box).map((c) => c.value);
          const keep = Array.from(chosen).filter((f) => !r.groups.some((g) => g.path === f)); // sections typed by hand stay
          x.folder = keep.concat(picked).join(", ");
          setSiteFolder(x, x.folder); now.textContent = x.folder || "whole website";
        }; });
      } catch (e) { box.innerHTML = `<p class="muted">⚠ ${esc(e.message)}</p>`; }
      finally { btn.disabled = false; btn.textContent = "🔎 Find again"; }
    }; });
    $$("input[name=mode]").forEach((r) => { r.onchange = () => { $("#folderBox").hidden = r.value !== "folder" || !r.checked; }; });
    $("#maxPages").oninput = (e) => { $("#mins").textContent = Math.max(1, Math.round((+e.target.value || 0) / 3 / 60)); };
  }
  if (step === 4) {
    $("#gscFile").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { pendingGsc = E.readGsc(await f.text()); $("#gscInfo").textContent = "✓ " + plural(pendingGsc.length, "row") + " ready for the next scan"; }
      catch (err) { pendingGsc = null; $("#gscInfo").textContent = "⚠ " + err.message; }
    };
  }
}

// Reads the current step's inputs into the draft. Returns false when something required is missing.
function readComps() {
  return $$(".comp-row").map((r) => { const x = splitLink($(".cDomain", r).value); return { domain: x.domain, folder: cleanFolder($(".cFolder", r).value) || x.folder, niche: $(".cNiche", r).value.trim() }; });
}

async function collect(step, lenient) {
  const v = (id) => ($("#" + id) ? $("#" + id).value.trim() : "");
  if (step === 1) {
    draft.brand = { ...draft.brand, name: v("bName"), about: v("bAbout"), audience: v("bAudience"), avoid: v("bAvoid"), offer: v("bOffer"), kb: v("bKb") };
    const mine = splitLink(v("bDomain"));
    draft.domain = mine.domain; draft.name = draft.brand.name || draft.domain;
    draft.scan.yourFolder = cleanFolder(v("bFolder")) || mine.folder;
    if (!lenient && !draft.domain) { toast("Add your website first.", true); $("#bDomain").focus(); return false; }
    if (!lenient && !draft.brand.about) { toast("Tell us in a sentence what you do — it powers the scores.", true); $("#bAbout").focus(); return false; }
  }
  if (step === 2) {
    draft.competitors = readComps().filter((c, i, a) => c.domain || a.length === 1);
    draft.scan.compUrls = v("compUrls");
    if (!lenient && !draft.competitors.some((c) => c.domain)) { toast("Add at least one competitor.", true); return false; }
    if (!lenient && draft.competitors.some((c) => c.domain === draft.domain)) { toast("A competitor can't be your own website.", true); return false; }
  }
  if (step === 3) {
    const mode = ($("input[name=mode]:checked") || {}).value || "full";
    draft.scan = { ...draft.scan, mode, folder: v("folder") || "/blog/", maxPages: Math.max(20, Math.min(50000, +v("maxPages") || 2000)), maxSubs: Math.max(1, Math.min(60, +v("maxSubs") || 15)), useSubs: $("#useSubs").checked, yourUrls: v("yourUrls") };
  }
  if (step === 4) {
    local("gemKey", v("gemKey"));
    draft.power = { ...draft.power, nIdeas: Math.max(3, Math.min(40, +v("nIdeas") || 15)), model: v("model") || "gemini-2.5-flash", searx: v("searx"), serpLimit: Math.max(5, Math.min(500, +v("serpLimit") || 80)), engines: v("engines"), lang: v("lang") || "en", gl: v("gl") || "us" };
  }
  if (draft.domain) await saveDraft(true);
  return true;
}

async function saveDraft(quiet) {
  if (!draft.domain) { toast("Add your website in step 1.", true); return false; }
  const isNew = !draft.id;
  if (isNew) draft.id = newId();
  const { id, name, domain, brand, competitors, scan: sc, power } = draft;
  try { await db("projects/" + id, "PUT", { name: name || domain, domain, brand, competitors: competitors.filter((c) => c.domain), scan: sc, power }); }
  catch (e) { if (isNew) draft.id = undefined; toast("Couldn't save: " + e.message, true); return false; }
  delete cache[id];
  if (!quiet) toast("Project saved");
  if (isNew && quiet) history.replaceState(null, "", location.pathname + location.search + `#/p/${id}/edit/${(location.hash.match(/\/edit\/(\d)/) || [0, 1])[1]}`);
  return true;
}

// ---------------- scanning ----------------
async function scanView(id) {
  if (!$("#scanBox")) view.innerHTML = `<div class="card muted">Getting the scan ready…</div>`;
  const project = await db("projects/" + encodeURIComponent(id));
  setCrumbs(`/ <a href="#/">Projects</a> / <a href="#/p/${esc(id)}">${esc(project.name)}</a> / Scan`);
  if (!scan || scan.id !== id || !scan.running) {
    if (scan && scan.running) { view.innerHTML = `<div class="card emptybig"><b>⏳</b>Another project is scanning right now.<br><br><a class="btn" href="#/p/${esc(scan.id)}/scan">See that scan</a></div>`; return; }
    runScan(project);
  }
  drawScan();
}

function drawScan() {
  if (!scan || !location.hash.endsWith("/" + scan.id + "/scan")) return;
  if (!$("#scanBox")) {
    view.innerHTML = `<div class="wiz" id="scanBox"><h1>Reading the websites… <span class="grad">📚</span></h1>
      <p class="lead">Grab a cup of tea ☕ — you can leave this tab open in the background. Don't close it until it's done.</p>
      <div class="card" style="margin-top:22px"><div id="scanNow" class="bignum"></div><div class="bar"><i id="scanBar"></i></div>
        <div class="scan-sites" id="scanSites"></div>
        <div class="wiz-foot"><button class="btn danger" id="scanStop">■ Stop and keep what we have</button></div>
        <details class="log"><summary>Show the detailed log</summary><div id="log"></div></details></div></div>`;
    $("#scanStop").onclick = () => { E.state.stopped = true; $("#scanStop").disabled = true; $("#scanNow").textContent = "Stopping… finishing the pages in flight."; };
  }
  $("#scanNow").textContent = scan.now || "";
  $("#scanBar").style.width = Math.round((scan.progress || 0) * 100) + "%";
  $("#scanSites").innerHTML = scan.sites.map((s, i) => `<div class="scan-site ${i === scan.idx && scan.running ? "on" : ""}"><span class="st">${s.state === "done" ? "✅" : s.state === "busy" ? "⏳" : s.state === "fail" ? "⚠️" : "⏸️"}</span>
    <div><span class="nm">${esc(s.domain)}${s.folder ? `<span class="muted"> ${esc(s.folder)}</span>` : ""}</span>${s.isYou ? " " + pill("you", "blue") : s.niche ? " " + pill(s.niche) : ""}<small>${esc(s.note || (s.state === "wait" ? "Waiting its turn" : ""))}</small></div>
    <span class="muted">${s.pages ? plural(s.pages, "page") : ""}</span></div>`).join("");
  $("#log").textContent = scan.log.join("\n");
}

async function runScan(project) {
  const sc = { ...DEFAULT_SCAN, ...(project.scan || {}) }, pw = { ...DEFAULT_POWER, ...(project.power || {}) };
  const you = project.domain;
  let comps = (project.competitors || []).filter((c) => c.domain && c.domain !== you);
  // Extra pasted URLs, grouped by site; links to a new site add it as a competitor.
  // One link per line, optionally followed by its title: "link | title" (or a tab or spaces).
  const titles = {};
  const lines = (t) => String(t || "").split(/\n+/).map((line) => {
    const m = line.trim().match(/^(https?:\/\/\S+)\s*(?:[|\t,]\s*)?(.*)$/i);
    if (!m) return null; const u = m[1].replace(/[,|]+$/, ""); if (m[2]) titles[u] = m[2].trim(); return u;
  }).filter(Boolean);
  const extra = {};
  lines(sc.yourUrls).forEach((u) => { (extra[you] = extra[you] || []).push(u); });
  lines(sc.compUrls).forEach((u) => {
    const h = E.root(u); let d = (comps.find((c) => h === c.domain || h.endsWith("." + c.domain)) || {}).domain;
    if (!d) { const parts = h.split("."); d = parts.slice(parts.length > 2 && /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) ? -3 : -2).join("."); if (d === you) return; comps.push({ domain: d, niche: "" }); }
    (extra[d] = extra[d] || []).push(u);
  });
  comps = comps.slice(0, 10);
  const opts = { extra, titles, full: sc.mode !== "sample", pathFilter: sc.mode === "folder" ? String(sc.folder).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : [],
    maxPages: sc.maxPages, maxSubs: sc.maxSubs, useSubs: sc.useSubs, searx: pw.searx, engines: pw.engines, serpLimit: pw.serpLimit, lang: pw.lang, gl: pw.gl };

  scan = { id: project.id, running: true, idx: 0, progress: 0, now: "Getting ready…", log: [],
    sites: [{ domain: you, isYou: true, folder: sc.yourFolder || "", state: "wait" }].concat(comps.map((c) => ({ domain: c.domain, niche: c.niche, folder: c.folder || "", state: "wait" }))) };
  E.state.stopped = false; E.state.serpChecked = new Set();
  E.hooks.log = (m) => { scan.log.push(m); drawScan(); };
  E.hooks.status = (m) => { scan.now = m; const s = scan.sites[scan.idx]; if (s && s.state === "busy") s.note = m.replace(/^Crawling [^:]+: /, ""); drawScan(); };
  E.hooks.progress = () => {};

  try {
    const sites = [];
    for (let i = 0; i < scan.sites.length && !E.state.stopped; i++) {
      scan.idx = i; const s = scan.sites[i]; s.state = "busy"; s.note = "Finding subdomains and sitemaps…"; drawScan();
      // A site's own section wins over the shared folder setting.
      const siteOpts = s.folder ? { ...opts, pathFilter: folderList(s.folder) } : opts;
      // One site failing must not stop the others.
      let site;
      try { site = await E.crawlSite(s.domain, siteOpts, (f) => { scan.progress = (i + f) / scan.sites.length; drawScan(); }); }
      catch (err) { scan.log.push(`[${s.domain}] skipped: ${err.message}`); site = { domain: E.root(s.domain), hosts: [], pages: [], ranked: null, discovered: 0, queuedLeft: 0 }; }
      site.niche = s.niche || ""; site.isYou = !!s.isYou;
      s.state = site.pages.length ? "done" : "fail"; s.pages = site.pages.length;
      s.note = site.pages.length ? `${site.hosts.length} subdomain(s) · ${site.queuedLeft ? site.queuedLeft.toLocaleString() + " more pages found than the limit" : "whole site read"}` : (site.refused ? "This site doesn't allow automated visits — paste its article links in step 2 (see the log)" : "Nothing found in this section — check the section link");
      sites.push(site); drawScan();
    }
    if (!sites.length) throw new Error("Stopped before any site was read.");
    const prev = await db(`projects/${project.id}/crawls`).catch(() => []);
    const last = prev.find((c) => c.finished_at && c.summary);
    let gsc = pendingGsc;
    if (!gsc && last && last.summary.gscRows) { gsc = last.summary.gscRows; scan.log.push("Using the Search Console file from the previous scan."); }
    if (gsc) { sites[0].ranked = gsc.slice(); sites[0].gsc = true; }
    if (opts.searx) { E.state.stopped = false; scan.now = "Looking up who ranks (SearXNG)…"; drawScan(); await E.serpCheck(sites, opts); }
    sites.forEach(E.attachRanks);

    const report = analyze(project, sites);
    scan.now = "Saving to your project database…"; drawScan();
    const summary = await saveScan(project, report, gsc);
    pendingGsc = null;
    cache[project.id] = { project, report, summary, scans: prev.filter((x) => x.finished_at).length + 1 };

    const key = local("gemKey");
    if (key) {
      scan.now = "✨ The AI is building your topical map…"; drawScan();
      try { await runPlan(project, report, summary); } catch (e) { scan.log.push("AI planner: " + e.message); toast("AI planner: " + e.message, true); }
    }
    scan.running = false; scan = null;
    delete cache[project.id].backlog;
    location.hash = `#/p/${project.id}/next`;
    toast("Scan finished 🎉");
  } catch (e) {
    scan.running = false; scan.now = "⚠️ " + e.message; drawScan();
    const b = $("#scanStop"); if (b) { b.textContent = "Back to the project"; b.disabled = false; b.onclick = () => { scan = null; location.hash = `#/p/${project.id}`; }; }
  }
}

// Turns crawled sites into the report the dashboard shows (same shape after a reload).
function analyze(project, sites) {
  const report = { you: sites[0], comps: sites.slice(1), brand: project.brand || {} };
  report.topics = E.topicMap(report);
  // Koray's framework, without AI: topics that match your products are "core";
  // other on-brand topics are "outer" (supporting) topics.
  const offer = new Set(E.tokens(report.brand.offer).filter((w) => !E.STOPSET.has(w)).map(E.stem));
  report.topics.forEach((t) => {
    t.youDomain = report.you.domain;
    const words = t.topic.split(" ").map(E.stem);
    t.section = t.verdict === "off-brand" ? "off" : words.some((w) => offer.has(w)) ? "core" : "outer";
  });
  report.kwGap = E.keywordGap(report.you, report.comps);
  report.topicGap = E.topicGap(report.you, report.comps);
  return report;
}

const compactSite = (s) => ({ domain: s.domain, niche: s.niche || "", isYou: !!s.isYou, discovered: s.discovered || 0, queuedLeft: s.queuedLeft || 0, pages: s.pages.length,
  hosts: (s.hosts || []).map((H) => ({ host: H.host, names: H.names || [], title: H.title != null ? H.title : (H.home && H.home.title) || "", sitemap: H.sitemap != null ? H.sitemap : (H.sitemapUrls || []).length, source: H.source || "" })),
  ranked: (s.ranked || []).slice(0, 5000) });

async function saveScan(project, report, gsc) {
  const all = [report.you].concat(report.comps);
  const { id: cid } = await db(`projects/${project.id}/crawls`, "POST", {});
  const rows = [];
  all.forEach((s) => s.pages.forEach((p) => rows.push({ site: s.domain, url: p.finalUrl, type: p.type, title: p.title, h1: (p.h1 || [])[0] || "", mainKeyword: p.mainKeyword, keywords: p.keywords, cluster: p.cluster, depth: p.depth, inlinks: p.inlinks })));
  for (let i = 0; i < rows.length; i += 1000) {
    if (scan) { scan.now = `Saving pages… ${Math.min(rows.length, i + 1000).toLocaleString()} / ${rows.length.toLocaleString()}`; drawScan(); }
    await db(`crawls/${cid}/pages`, "POST", { pages: rows.slice(i, i + 1000) });
  }
  const merge = await db(`projects/${project.id}/topics`, "PUT", { topics: report.topics.filter((t) => t.section !== "off").map(topicRecord) });
  const summary = { crawlId: cid, at: Date.now(), sites: all.map(compactSite), serpChecked: Array.from(E.state.serpChecked), gscRows: gsc || null, merge };
  await db(`crawls/${cid}/finish`, "POST", { summary });
  return summary;
}

const topicKey = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
function topicRecord(t) {
  const yours = t.by[t.youDomain] || [];
  const examples = Object.keys(t.by).filter((d) => d !== t.youDomain).flatMap((d) => t.by[d].slice(0, 2).map((p) => p.finalUrl)).slice(0, 6);
  return { key: topicKey(t.topic), label: t.topic, section: t.section, score: t.score, coveredUrl: t.you ? (yours[0] || {}).finalUrl || null : null,
    data: { source: "scan", relevance: t.relevance, gap: t.gap, demand: t.demand, rankability: t.rankability, compsWith: t.compsWith, total: t.total, verdict: t.verdict, keywords: t.keywords, examples } };
}

// Asks Gemini for the Koray-style topical map, checks keywords in Autocomplete, and stores it all.
async function runPlan(project, report, summary) {
  const key = local("gemKey"); if (!key) throw new Error("Add your Gemini key in Settings first.");
  const pw = { ...DEFAULT_POWER, ...(project.power || {}) };
  const plan = await askGemini(key, pw.model, buildPlanPrompt(project, report, pw.nIdeas));
  await checkAutocomplete(plan.ideas, pw.lang, pw.gl);
  plan.at = Date.now();
  summary.plan = plan;
  await db(`crawls/${summary.crawlId}/finish`, "POST", { summary });
  await db(`projects/${project.id}/topics`, "PUT", { topics: plan.ideas.map((it) => ({ key: topicKey(it.topic), label: it.topic, section: it.section === "core" ? "core" : "outer", score: it.topic_score || 0, coveredUrl: null, data: { source: "ai", ...it } })) });
  return plan;
}

// ---------------- loading a project ----------------
async function loadProject(id) {
  if (cache[id] && cache[id].report && cache[id].backlog) return cache[id];
  const c = cache[id] || {};
  c.project = c.project || await db("projects/" + encodeURIComponent(id));
  if (!c.report) {
    const crawls = await db(`projects/${id}/crawls`);
    const last = crawls.find((x) => x.finished_at && x.summary);
    c.summary = last ? last.summary : null;
    c.scans = crawls.filter((x) => x.finished_at).length;
    if (last) {
      const pages = [];
      for (let off = 0; ; off += 5000) { const batch = await db(`crawls/${last.id}/pages?offset=${off}&limit=5000`); pages.push(...batch); if (batch.length < 5000) break; }
      const bySite = {};
      pages.forEach((r) => {
        const p = { finalUrl: r.url, url: r.url, type: r.type, title: r.title, h1: r.h1 ? [r.h1] : [], h2: [], mainKeyword: r.main_keyword || "", keywords: r.keywords || [], cluster: r.cluster,
          depth: r.depth, inlinks: r.inlinks, ranks: [], indexable: true };
        try { p.host = new URL(r.url).host; } catch (_) {}
        p.onPageKeyword = p.keywords[0] || p.mainKeyword; p.keywordSource = p.mainKeyword ? "on-page" : ""; p.topic = E.topicOf(p);
        (bySite[r.site] = bySite[r.site] || []).push(p);
      });
      const sites = c.summary.sites.map((s) => ({ ...s, hosts: s.hosts, pages: bySite[s.domain] || [], ranked: s.ranked && s.ranked.length ? s.ranked : null, gsc: s.isYou && !!c.summary.gscRows }));
      E.state.serpChecked = new Set(c.summary.serpChecked || []);
      sites.forEach(E.attachRanks);
      c.report = analyze(c.project, sites);
    }
  }
  if (!c.backlog) c.backlog = await db(`projects/${id}/topics`);
  if (!c.changes && c.report) c.changes = await db(`projects/${id}/changes`).catch(() => ({ newPages: [] }));
  cache[id] = c;
  return c;
}

// ---------------- dashboard ----------------
const TABS = [
  ["next", "⭐ Write next"], ["map", "🗺️ Topical map"], ["list", "📋 My topic list"],
  ["changes", "🔄 What changed"], ["compare", "🧩 Compare topics"], ["details", "📊 Details"],
];

async function dashboard(id, tab) {
  view.innerHTML = `<div class="card muted">Loading your project…</div>`;
  const c = await loadProject(id), p = c.project, R = c.report;
  setCrumbs(`/ <a href="#/">Projects</a> / ${esc(p.name)}`);
  if (scan && scan.running && scan.id === id) { location.hash = `#/p/${id}/scan`; return; }
  const head = `<div class="dhead"><div><h1>${esc(p.name)}</h1><p class="lead">${esc(p.domain)} vs ${(p.competitors || []).map((x) => esc(x.domain)).join(", ") || "no competitors yet"}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost" href="#/p/${esc(id)}/edit/1">✏️ Edit project</a>
    <button class="btn danger ghost" id="delProj">🗑️ Delete</button><a class="btn primary" href="#/p/${esc(id)}/scan">🔄 ${R ? "Scan again" : "Start the first scan"}</a></div></div>`;
  if (!R) {
    view.innerHTML = head + `<div class="card emptybig" style="margin-top:20px"><b>🚀</b><h2>No scan yet</h2><p style="margin:8px 0 20px">Start a scan and we'll read your site and your competitors' sites.</p><a class="btn primary" href="#/p/${esc(id)}/scan">Start the first scan</a></div>`;
    wireDelete(p); return;
  }
  R.topics.forEach((t) => { t.youDomain = R.you.domain; });
  const gaps = R.topics.filter((t) => !t.you && t.section !== "off");
  const merge = (c.summary && c.summary.merge) || { created: [], covered: [] };
  view.innerHTML = head +
    `<div class="kpis">
      <div class="kpi"><b>${R.you.pages.length.toLocaleString()}</b><span>of your pages read</span></div>
      <div class="kpi"><b>${R.comps.reduce((n, s) => n + s.pages.length, 0).toLocaleString()}</b><span>competitor pages read</span></div>
      <div class="kpi"><b>${gaps.length.toLocaleString()}</b><span>topics they cover, you don't</span></div>
      <div class="kpi"><b class="grad">${gaps.filter((t) => t.score >= 70).length}</b><span>great topics to write next</span></div>
      <div class="kpi"><b>${merge.covered.length}</b><span>topics you covered since last scan</span></div>
    </div>
    <p class="muted" style="font-size:13px">Last scan: ${when(c.summary.at)} · ${plural(c.scans || 1, "scan")} so far</p>
    <nav class="tabs">${TABS.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${n}</button>`).join("")}</nav>
    <section id="tab"></section>`;
  $$(".tabs button").forEach((b) => { b.onclick = () => { location.hash = `#/p/${id}/${b.dataset.t}`; }; });
  wireDelete(p);
  const T = $("#tab");
  ({ next: tabNext, map: tabMap, list: tabList, changes: tabChanges, compare: tabCompare, details: tabDetails }[tab] || tabNext)(T, c);
}

function wireDelete(p) {
  $("#delProj").onclick = () => deleteProject(p, () => { location.hash = "#/"; });
}

// ⭐ Write next
function tabNext(T, c) {
  const plan = c.summary.plan, R = c.report, p = c.project;
  const backlog = new Map(c.backlog.map((t) => [t.key, t]));
  let items;
  if (plan) items = plan.ideas.map((it) => ({ ...it, key: topicKey(it.topic), score: it.topic_score || 0 }));
  else items = R.topics.filter((t) => !t.you && t.section !== "off").slice(0, 20).map((t) => ({
    key: topicKey(t.topic), topic: t.topic, primary_keyword: t.topic, section: t.section, score: t.score, relevance: t.relevance, gap: t.gap, demand: t.demand, rankability: t.rankability,
    why: `${t.compsWith} of your ${R.comps.length} competitors write about this (${plural(t.total - t.you, "page")}), and you have no page on it yet.`,
    competitor_urls: Object.keys(t.by).filter((d) => d !== R.you.domain).flatMap((d) => t.by[d].slice(0, 2).map((x) => x.finalUrl)).slice(0, 4), secondary_keywords: t.keywords.split(", ").slice(1) }));
  T.innerHTML = explain(plan
    ? "These are the topics the AI picked for you, best first. The <b>score</b> mixes how well it fits your brand, how big the gap is, and how likely you are to rank. Click <b>Add to my plan</b> to keep it."
    : `These are the best gaps we found, best first. ${local("gemKey") ? "" : `For keywords, titles and outlines written for you, <a href="#/settings">add a free Gemini key</a> and click the button below.`}`) +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px"><button class="btn ${plan ? "" : "primary"}" id="aiPlan">✨ ${plan ? "Ask the AI again" : "Ask the AI for a full plan"}</button>
      <button class="btn ghost" id="ideasCsv">⬇ Download as CSV</button></div><div id="ideas"></div>`;
  $("#ideas").innerHTML = items.length ? items.map((it, i) => ideaCard(it, i, backlog.get(it.key), p)).join("") : `<div class="card emptybig"><b>🏆</b>No gaps found — you already cover everything your competitors write about!</div>`;
  $("#aiPlan").onclick = async () => {
    const b = $("#aiPlan"); b.disabled = true; b.textContent = "✨ Thinking… (about 30 seconds)";
    try { await runPlan(p, R, c.summary); c.backlog = await db(`projects/${p.id}/topics`); toast("Your new plan is ready"); tabNext(T, c); }
    catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "✨ Try again"; }
  };
  $("#ideasCsv").onclick = () => download(`topic-ideas-${p.domain}.csv`, toCsv([["Rank", "Topic", "Section", "Primary keyword", "Secondary keywords", "Score", "Relevance", "Rank potential", "Intent", "Type", "Title", "Why", "Autocomplete", "Competitor URLs", "Link to", "Outline"]]
    .concat(items.map((it, i) => [i + 1, it.topic, it.section, it.primary_keyword, (it.secondary_keywords || []).join("; "), it.score, it.relevance, it.rank_potential != null ? it.rank_potential : it.rankability, it.search_intent, it.content_type, it.suggested_title, it.why, it.autocomplete, (it.competitor_urls || []).join(" "), it.link_to, (it.outline || []).join(" / ")]))));
  wireIdeas(T, c, items);
}

function ideaCard(it, i, saved, p) {
  const status = saved ? saved.status : null;
  const ac = { exact: ["✓ people search this on Google", "good"], prefix: ["✓ people search longer versions", "good"], related: ["~ only similar searches", "mid"], none: ["✗ not seen in Google suggestions", "low"] }[it.autocomplete];
  return `<article class="idea ${i === 0 ? "top" : ""}" data-i="${i}">
    <div>${scoreRing(it.score)}</div>
    <div>
      <div class="chips" style="margin:0">${i === 0 ? pill("★ Best pick", "star") : pill("#" + (i + 1))}${pill(it.section === "core" ? "🎯 Core topic" : "🌱 Supporting topic", it.section === "core" ? "blue" : "")}${status && status !== "gap" ? pill("In your list: " + status, "good") : ""}</div>
      <h3>${esc(it.suggested_title || it.topic)}</h3>
      <div class="kw">🔑 ${esc(it.primary_keyword)}</div>
      <p class="why">${esc(it.why || "")}</p>
      <div class="bars">${scoreBar(it.relevance, "Fits your brand")}${scoreBar(it.rank_potential != null ? it.rank_potential : it.rankability, "Chance to rank")}${it.gap != null ? scoreBar(it.gap, "Size of the gap") : ""}${it.demand != null ? scoreBar(it.demand, "Competitor interest") : ""}</div>
      <div class="chips">${[it.search_intent, it.content_type].filter(Boolean).map((x) => pill(x)).join("")}${ac ? pill(ac[0], ac[1]) : ""}</div>
      <div class="acts">
        <button class="btn sm ${status === "planned" ? "" : "primary"}" data-act="plan">${status && status !== "gap" ? "✓ In my plan" : "📌 Add to my plan"}</button>
        <button class="btn sm" data-act="brief">📝 Show the brief</button>
        <button class="btn sm ghost" data-act="serp">🔎 Who ranks today?</button>
      </div>
      <div class="more" hidden>
        ${it.attribute ? `<div class="lbl">Part of</div><div>${esc(it.attribute)}</div>` : ""}
        ${(it.secondary_keywords || []).length ? `<div class="lbl">Also mention</div><div class="muted">${esc(it.secondary_keywords.join(", "))}</div>` : ""}
        ${(it.related || []).length ? `<div class="lbl">People also search (Google)</div><div class="muted">${esc(it.related.join(", "))}</div>` : ""}
        ${(it.outline || []).length ? `<div class="lbl">Outline</div><ol>${it.outline.map((o) => `<li>${esc(o)}</li>`).join("")}</ol>` : ""}
        ${(it.competitor_urls || []).length ? `<div class="lbl">Competitors who wrote about it</div>${it.competitor_urls.map((u) => `<div>${link(u)}</div>`).join("")}` : ""}
        ${it.link_to ? `<div class="lbl">Link it to</div><div>${/^https?:/.test(it.link_to) ? link(it.link_to) : esc(it.link_to)}</div>` : ""}
      </div>
      <div class="serpbox"></div>
    </div></article>`;
}

function wireIdeas(T, c, items) {
  const p = c.project, pw = { ...DEFAULT_POWER, ...(p.power || {}) };
  $$(".idea", T).forEach((card) => {
    const it = items[+card.dataset.i];
    $("[data-act=brief]", card).onclick = (e) => { const m = $(".more", card); m.hidden = !m.hidden; e.target.textContent = m.hidden ? "📝 Show the brief" : "📝 Hide the brief"; };
    $("[data-act=plan]", card).onclick = async (e) => {
      try {
        await db(`projects/${p.id}/topics`, "PUT", { topics: [{ key: it.key, label: it.topic, section: it.section === "core" ? "core" : "outer", score: it.score, coveredUrl: null, data: { source: c.summary.plan ? "ai" : "scan", ...it } }] });
        await db(`projects/${p.id}/topics/${encodeURIComponent(it.key)}`, "PATCH", { status: "planned" });
        c.backlog = await db(`projects/${p.id}/topics`);
        e.target.textContent = "✓ In my plan"; e.target.classList.remove("primary"); toast("Added to your topic list");
      } catch (err) { toast(err.message, true); }
    };
    $("[data-act=serp]", card).onclick = async (e) => {
      const box = $(".serpbox", card), q = it.primary_keyword;
      if (!pw.searx) { window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank", "noopener"); return; }
      box.innerHTML = `<div class="serp muted">Searching…</div>`;
      try {
        const rows = await serpSnapshot(pw.searx, q, pw.lang, pw.engines);
        const mine = [p.domain].concat((p.competitors || []).map((x) => x.domain));
        box.innerHTML = `<div class="serp"><b>Top results for “${esc(q)}”</b><ol>${rows.map((r) => { const h = E.root(r.url); const who = mine.find((d) => h === d || h.endsWith("." + d)); return `<li>${link(r.url, r.title || r.url)} ${who ? pill(who === p.domain ? "you" : who, who === p.domain ? "good" : "mid") : ""}</li>`; }).join("")}</ol></div>`;
      } catch (err) { box.innerHTML = `<div class="serp muted">${esc(err.message)}</div>`; }
    };
  });
}

// 🗺️ Topical map (Koray's framework)
function tabMap(T, c) {
  const R = c.report, plan = c.summary.plan, backlog = new Map(c.backlog.map((t) => [t.key, t]));
  const nodes = { core: [], outer: [] };
  R.topics.filter((t) => t.you && t.section !== "off").forEach((t) => nodes[t.section].push({ label: t.topic, status: "covered", sub: "You have " + plural(t.you, "page"), url: (t.by[R.you.domain] || [])[0] && t.by[R.you.domain][0].finalUrl }));
  if (plan) plan.ideas.forEach((it) => nodes[it.section === "core" ? "core" : "outer"].push({ label: it.topic, status: (backlog.get(topicKey(it.topic)) || {}).status || "gap", sub: "✨ 🔑 " + it.primary_keyword + (it.attribute ? " · " + it.attribute : "") }));
  // Strong gaps from the scan itself (skipping ones the AI already listed).
  const listed = new Set((plan ? plan.ideas : []).flatMap((it) => [topicKey(it.topic), topicKey(it.primary_keyword)]));
  R.topics.filter((t) => !t.you && t.section !== "off" && t.score >= 50 && !listed.has(topicKey(t.topic))).forEach((t) => nodes[t.section].push({ label: t.topic, status: (backlog.get(topicKey(t.topic)) || {}).status || "gap", sub: `score ${t.score} · ${t.compsWith} competitor(s) write about it` }));
  const order = { gap: 0, planned: 1, writing: 1, covered: 2, published: 2, dismissed: 3 };
  const col = (k, title, emoji, text) => `<div class="tsec"><h3>${emoji} ${title} <span class="muted" style="font-weight:500">(${nodes[k].length})</span></h3><p>${text}</p>
    ${nodes[k].sort((a, b) => order[a.status] - order[b.status]).map((n) => `<div class="tnode"><span class="dot ${esc(n.status)}"></span><div><b>${esc(n.label)}</b><small>${esc(n.sub)}${n.url ? " · " : ""}${n.url ? link(n.url) : ""}</small></div></div>`).join("") || `<p>Nothing here yet.</p>`}</div>`;
  const offer = String(c.project.brand.offer || "").split(/\n|,/).map((x) => x.trim()).filter(Boolean);
  T.innerHTML = explain("This is your <b>topical map</b>, built with Koray Tuğberk GÜBÜR's framework. <b>Core</b> topics are about what you sell — they make money. <b>Supporting</b> topics answer the questions around them and link back to the core, which shows Google you're the expert on the whole subject.") +
    `<div class="tmap-head">
      <div><small>Source context — why you publish</small>${esc((plan && plan.source_context) || c.project.brand.about || "—")}</div>
      <div><small>Central entity — what the site is about</small>${esc((plan && plan.central_entity) || offer[0] || "—")}</div>
      <div><small>Central search intent</small>${esc((plan && plan.central_search_intent) || "Ask the AI for a plan to fill this in")}</div></div>
    <div class="legend"><span><i class="dot gap"></i> to write</span><span><i class="dot planned"></i> in your plan</span><span><i class="dot covered"></i> you have it</span></div>
    <div class="tmap">${col("core", "Core section", "🎯", "Money topics: directly about your products and services.")}${col("outer", "Outer section", "🌱", "Supporting topics that build authority and link to your core pages.")}</div>
    ${plan ? "" : `<p class="muted" style="margin-top:14px;font-size:13px">Without AI, “core” means the topic shares words with your products list (step 1). <a href="#/settings">Add a Gemini key</a> for a full map with a keyword for each topic.</p>`}`;
}

// 📋 My topic list (the database backlog)
function tabList(T, c) {
  const p = c.project;
  const statuses = ["gap", "planned", "writing", "published", "covered", "dismissed"];
  const names = { gap: "💡 To write", planned: "📌 Planned", writing: "✍️ Writing", published: "🚀 Published", covered: "✅ You have it", dismissed: "🙈 Not for us" };
  T.innerHTML = explain("Every topic we've found, saved in your project. Change the status as you work. After each scan we tick off topics you've published, and remember when.");
  T.appendChild(table([
    { h: "Topic", v: (t) => t.label, html: (t) => `<b>${esc(t.label)}</b>${t.data && t.data.primary_keyword && t.data.primary_keyword !== t.label ? `<br><span class="muted">🔑 ${esc(t.data.primary_keyword)}</span>` : ""}` },
    { h: "Status", v: (t) => t.status, html: (t) => `<select data-k="${esc(t.key)}">${statuses.map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${names[s]}</option>`).join("")}</select>` },
    { h: "Section", v: (t) => t.section === "core" ? "🎯 Core" : "🌱 Supporting" },
    { h: "Score", n: 1, v: (t) => t.score },
    { h: "From", v: (t) => (t.data && t.data.source === "ai" ? "✨ AI" : "🔍 Scan") },
    { h: "First found", v: (t) => t.first_seen, html: (t) => when(t.first_seen) },
    { h: "Covered on", v: (t) => t.covered_at, html: (t) => t.covered_at ? when(t.covered_at) : '<span class="muted">—</span>' },
    { h: "Your page", v: (t) => t.covered_url, html: (t) => link(t.covered_url) },
    { h: "Notes", v: (t) => t.notes, html: (t) => `<button class="btn sm ghost" data-note="${esc(t.key)}">${t.notes ? "📝 " + esc(String(t.notes).slice(0, 30)) : "＋ Note"}</button>` },
  ], c.backlog, { name: "topic-list-" + p.domain, filters: [{ label: "Status", values: statuses, get: (t) => t.status }, { label: "Section", values: ["core", "outer"], get: (t) => t.section }],
    after: (tb) => {
      $$("select[data-k]", tb).forEach((s) => { s.onchange = async () => { try { await db(`projects/${p.id}/topics/${encodeURIComponent(s.dataset.k)}`, "PATCH", { status: s.value }); const t = c.backlog.find((x) => x.key === s.dataset.k); if (t) t.status = s.value; toast("Saved"); } catch (e) { toast(e.message, true); } }; });
      $$("[data-note]", tb).forEach((b) => { b.onclick = async () => { const t = c.backlog.find((x) => x.key === b.dataset.note); const n = prompt("Note for “" + t.label + "”", t.notes || ""); if (n == null) return; await db(`projects/${p.id}/topics/${encodeURIComponent(t.key)}`, "PATCH", { notes: n }); t.notes = n; b.textContent = n ? "📝 " + n.slice(0, 30) : "＋ Note"; toast("Note saved"); }; });
    } }));
}

// 🔄 What changed since the previous scan
function tabChanges(T, c) {
  const merge = (c.summary && c.summary.merge) || { created: [], covered: [] }, ch = c.changes || { newPages: [] };
  const byKey = new Map(c.backlog.map((t) => [t.key, t]));
  const bySite = {}; (ch.newPages || []).filter((r) => r.site !== c.project.domain).forEach((r) => { (bySite[r.site] = bySite[r.site] || []).push(r); });
  T.innerHTML = explain(ch.previous ? `Compared with your scan on <b>${when(ch.previous)}</b>.` : "This is your first scan. Run another scan later and this page shows what changed: topics you covered, and new articles your competitors published.") +
    `<div class="tmap">
      <div class="tsec"><h3>✅ Topics you covered (${merge.covered.length})</h3><p>Gaps from earlier scans that you now have a page for. Nice work!</p>
        ${merge.covered.map((k) => { const t = byKey.get(k) || { label: k }; return `<div class="tnode"><span class="dot covered"></span><div><b>${esc(t.label)}</b><small>${link(t.covered_url)}</small></div></div>`; }).join("") || "<p>None yet.</p>"}</div>
      <div class="tsec"><h3>🆕 New topics found (${merge.created.length})</h3><p>Topics we hadn't seen before this scan.</p>
        ${merge.created.slice(0, 60).map((k) => { const t = byKey.get(k) || { label: k, status: "gap" }; return `<div class="tnode"><span class="dot ${esc(t.status)}"></span><div><b>${esc(t.label)}</b><small>score ${t.score || "—"}</small></div></div>`; }).join("") || "<p>None.</p>"}</div>
    </div>
    <h2 style="margin:26px 0 6px">📰 New competitor articles</h2><p class="muted">Pages that appeared on competitor sites since the previous scan.</p>`;
  if (!ch.previous) return;
  T.appendChild(table([
    { h: "Competitor", v: (r) => r.site }, { h: "Article", v: (r) => r.title || r.url, html: (r) => link(r.url, r.title || r.url) },
    { h: "Main keyword", v: (r) => r.main_keyword }, { h: "Topic", v: (r) => r.cluster },
  ], (ch.newPages || []).filter((r) => r.site !== c.project.domain), { name: "new-competitor-pages", filters: [{ label: "Competitor", values: Object.keys(bySite), get: (r) => r.site }], empty: "No new competitor articles since the last scan." }));
}

// 🧩 Compare topics with competitors
function tabCompare(T, c) {
  const R = c.report, hasRank = [R.you].concat(R.comps).some((s) => s.ranked);
  const verdicts = { "write next": "good", "worth it": "mid", covered: "blue", "off-brand": "", "low priority": "" };
  T.innerHTML = explain("Every topic on every site, side by side. The numbers show how many pages each website has on that topic. <b>0</b> under “You” means it's a gap. The <b>score</b> is 40% fits your brand + 25% size of the gap + 20% competitor interest + 15% chance to rank.");
  T.appendChild(table([
    { h: "Topic", v: (r) => r.topic, html: (r) => `<b>${esc(r.topic)}</b>` },
    { h: "Score", n: 1, v: (r) => r.score, html: (r) => `<b>${r.score}</b>` },
    { h: "Verdict", v: (r) => r.verdict, html: (r) => pill(r.verdict, verdicts[r.verdict]) },
    { h: "Section", v: (r) => r.section === "core" ? "🎯 Core" : r.section === "outer" ? "🌱 Supporting" : "—" },
    { h: "Fits brand", n: 1, v: (r) => r.relevance, tip: "How well the topic matches your brand profile and knowledge base" },
    { h: "Gap", n: 1, v: (r) => r.gap }, { h: "Interest", n: 1, v: (r) => r.demand, tip: "How many competitors write about it" }, { h: "Rank chance", n: 1, v: (r) => r.rankability },
    { h: "You", n: 1, v: (r) => r.you, html: (r) => r.you ? `<a href="${esc(R.you.pages.find((p) => p.cluster === r.topic) ? R.you.pages.find((p) => p.cluster === r.topic).finalUrl : "#")}" target="_blank" rel="noopener">${r.you}</a>` : '<b style="color:var(--low)">0</b>' },
  ].concat(R.comps.map((s) => ({ h: s.domain, n: 1, v: (r) => (r.by[s.domain] || []).length, html: (r) => { const ps = r.by[s.domain] || []; return ps.length ? `<a href="${esc(ps[0].finalUrl)}" target="_blank" rel="noopener" title="${esc(ps.slice(0, 10).map((x) => x.finalUrl).join("\n"))}">${ps.length}</a>` : '<span class="muted">0</span>'; } })))
    .concat([{ h: "Ranking keywords", n: 1, opt: 1, v: (r) => hasRank ? r.ranks : null }, { h: "Keywords in topic", v: (r) => r.keywords }]),
  R.topics, { name: "compare-topics", filters: [{ label: "Verdict", values: ["write next", "worth it", "low priority", "off-brand", "covered"], get: (r) => r.verdict }, { label: "Section", values: ["core", "outer", "off"], get: (r) => r.section }] }));
}

// 📊 Details: overview, subdomains, pages, keyword gap, rankings
function tabDetails(T, c, sub) {
  sub = sub || "overview";
  const R = c.report, all = [R.you].concat(R.comps), hasRank = all.some((s) => s.ranked), hasComp = R.comps.some((s) => s.ranked);
  const siteF = { label: "Site", values: all.map((s) => s.domain), get: (r) => r.site };
  const SUBS = [["overview", "Websites"], ["subdomains", "Subdomains"], ["pages", "All pages"], ["kwgap", "Keyword gap"], ["ranked", "Rankings"]];
  T.innerHTML = `<div class="subtabs">${SUBS.map(([k, n]) => `<button data-s="${k}" class="${k === sub ? "on" : ""}">${n}</button>`).join("")}</div><div id="sub"></div>`;
  $$(".subtabs button", T).forEach((b) => { b.onclick = () => tabDetails(T, c, b.dataset.s); });
  const S = $("#sub", T);
  if (sub === "overview") {
    S.innerHTML = explain("One row per website: how much we read, and how many topics each competitor has that you don't.");
    S.appendChild(table([
      { h: "Website", v: (s) => s.domain + (s === R.you ? " (you)" : "") }, { h: "Niche", v: (s) => s.niche || "" },
      { h: "Subdomains", n: 1, v: (s) => s.hosts.length }, { h: "Pages read", n: 1, v: (s) => s.pages.length },
      { h: "Articles", n: 1, v: (s) => s.pages.filter((p) => p.type === "article").length },
      { h: "Topics", n: 1, v: (s) => R.topics.filter((t) => t.by[s.domain]).length },
      { h: "Topics you lack", n: 1, v: (s) => s === R.you ? null : R.topics.filter((t) => t.by[s.domain] && !t.you).length, html: (s) => num(s === R.you ? null : R.topics.filter((t) => t.by[s.domain] && !t.you).length) },
      { h: "Not read (page limit)", n: 1, v: (s) => s.queuedLeft || 0, tip: "Pages we found but didn't read because of the page limit. Raise it in step 3." },
      { h: "Ranking keywords", n: 1, opt: 1, v: (s) => s.ranked ? s.ranked.length : null },
    ], all, { name: "websites" }));
  }
  if (sub === "subdomains") {
    const rows = [];
    all.forEach((s) => s.hosts.forEach((H) => {
      const ps = s.pages.filter((p) => p.host === H.host), freq = new Map();
      ps.forEach((p) => { if (p.cluster) freq.set(p.cluster, (freq.get(p.cluster) || 0) + 1); });
      rows.push({ site: s.domain, host: H.host, title: H.title, pages: ps.length, articles: ps.filter((p) => p.type === "article").length, sitemap: H.sitemap, source: H.source,
        topics: Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]).join(", "), aliases: (H.names || []).filter((n) => n !== H.host).join(", ") });
    }));
    S.innerHTML = explain("Every live subdomain we found (like blog.site.com), and its main topics.");
    S.appendChild(table([
      { h: "Website", v: (r) => r.site }, { h: "Subdomain", v: (r) => r.host, html: (r) => link("https://" + r.host + "/", r.host) }, { h: "Home page title", v: (r) => r.title },
      { h: "Pages read", n: 1, v: (r) => r.pages }, { h: "Articles", n: 1, v: (r) => r.articles }, { h: "In sitemap", n: 1, v: (r) => r.sitemap },
      { h: "Main topics", v: (r) => r.topics }, { h: "Found via", v: (r) => r.source }, { h: "Also answers on", v: (r) => r.aliases },
    ], rows, { name: "subdomains", filters: [siteF] }));
  }
  if (sub === "pages") {
    const rows = []; all.forEach((s) => s.pages.forEach((p) => rows.push({ site: s.domain, p })));
    S.innerHTML = explain("Every page we read. <b>Main keyword</b> is what the page is about. Listing pages (blog index, page 2, tags) are hidden by default — they're used only to find articles.");
    S.appendChild(table([
      { h: "Website", v: (r) => r.site }, { h: "Page", v: (r) => r.p.finalUrl, html: (r) => link(r.p.finalUrl) }, { h: "Type", v: (r) => r.p.type },
      { h: "Main keyword", v: (r) => r.p.mainKeyword, html: (r) => `<b>${esc(r.p.mainKeyword)}</b>` }, { h: "Topic", v: (r) => r.p.cluster || "" },
      { h: "Title", v: (r) => r.p.title }, { h: "Other keywords", v: (r) => (r.p.keywords || []).slice(1).join(", ") },
      { h: "Best position", n: 1, opt: 1, v: (r) => r.p.ranks[0] ? r.p.ranks[0].position : null },
      { h: "Clicks from home", n: 1, v: (r) => r.p.depth, tip: "How many clicks from the home page" }, { h: "Links to it", n: 1, v: (r) => r.p.inlinks, tip: "Internal links pointing to this page" },
    ], rows, { name: "pages", filters: [siteF, { label: "Type", values: ["article", "page", "home", "listing"], get: (r) => r.p.type }, { label: "Show", initial: "topics only", values: ["topics only", "listings only"], get: (r) => r.p.type === "listing" ? "listings only" : "topics only" }] }));
  }
  if (sub === "kwgap") {
    if (!hasComp) { S.innerHTML = `<div class="card emptybig"><b>🏁</b>To compare keywords you need competitor rankings.<br>Add a free SearXNG address in step 4 (Power-ups) and scan again.<br><br><a class="btn" href="#/p/${esc(c.project.id)}/edit/4">Open Power-ups</a></div>`; return; }
    S.innerHTML = explain("<b>missing</b>: a competitor is in Google's top 20 and you aren't. <b>weak</b>: you rank, but far below them. <b>shared</b>: about level. <b>unique</b>: only you rank.");
    S.appendChild(table([
      { h: "Keyword", v: (r) => r.keyword, html: (r) => `<b>${esc(r.keyword)}</b>` },
      { h: "Status", v: (r) => r.status, html: (r) => pill(r.status, { missing: "low", weak: "mid", shared: "good", unique: "blue" }[r.status]) },
      { h: "You", n: 1, v: (r) => r.you, html: (r) => r.you ? link(r.yourUrl, "#" + r.you) : '<span class="muted">—</span>' },
    ].concat(R.comps.map((s) => ({ h: s.domain, n: 1, v: (r) => r.comps[s.domain] ? r.comps[s.domain].position : null, html: (r) => r.comps[s.domain] ? link(r.comps[s.domain].url, "#" + r.comps[s.domain].position) : '<span class="muted">—</span>' })))
      .concat([{ h: "Impressions (GSC)", n: 1, opt: 1, v: (r) => r.volume }, { h: "Opportunity", n: 1, v: (r) => r.opportunity }]),
    R.kwGap, { name: "keyword-gap", filters: [{ label: "Status", values: ["missing", "weak", "shared", "unique"], get: (r) => r.status }] }));
  }
  if (sub === "ranked") {
    if (!hasRank) { S.innerHTML = `<div class="card emptybig"><b>📈</b>No ranking data yet. Upload a Search Console file or add SearXNG in step 4, then scan again.<br><br><a class="btn" href="#/p/${esc(c.project.id)}/edit/4">Open Power-ups</a></div>`; return; }
    const rows = []; all.forEach((s) => (s.ranked || []).forEach((k) => rows.push({ site: s.domain, ...k })));
    S.innerHTML = explain("Every keyword we know a position for. Search Console rows are your real Google data; SearXNG rows are approximate.");
    S.appendChild(table([
      { h: "Website", v: (r) => r.site }, { h: "Keyword", v: (r) => r.keyword }, { h: "Position", n: 1, v: (r) => r.position },
      { h: "Clicks", n: 1, opt: 1, v: (r) => r.clicks }, { h: "Impressions", n: 1, opt: 1, v: (r) => r.volume }, { h: "Source", v: (r) => r.source }, { h: "Page", v: (r) => r.url, html: (r) => link(r.url) },
    ], rows, { name: "rankings", filters: [siteF] }));
  }
}

route();
