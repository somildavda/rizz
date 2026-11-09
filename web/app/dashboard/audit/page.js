"use client";
import { useEffect, useRef, useState } from "react";
import { useSuite, NeedProject, Kpi, Table } from "../../../components/Suite";
import { db, canRun, fmt, when, pool, downloadCsv } from "../../../lib/api";

const get = (path) => fetch("/api/cg/" + path).then((r) => r.json());
const sameSite = (a, b) => a.replace(/^www\./, "") === b.replace(/^www\./, "");
const skipExt = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|xml|ico|woff2?)(\?|$)/i;

// Checks each page and groups the problems found.
function findIssues(pages) {
  const list = [], add = (sev, id, label, urls, tip) => urls.length && list.push({ sev, id, label, urls, tip });
  const ok = pages.filter((p) => p.ok), dup = (key) => {
    const m = new Map(); ok.forEach((p) => { const k = (p[key] || "").trim().toLowerCase(); if (k) m.set(k, [...(m.get(k) || []), p.url]); });
    return [...m.values()].filter((v) => v.length > 1).flat();
  };
  const crawled = new Map(pages.map((p) => [p.url, p]));
  const brokenLinks = [];
  ok.forEach((p) => (p.internal || []).forEach((l) => { const t = crawled.get(l); if (t && !t.ok) brokenLinks.push(p.url + " → " + l); }));

  add("error", "broken", "Pages that don't load (4xx/5xx or failed)", pages.filter((p) => !p.ok).map((p) => `${p.url} (${p.error || p.status})`), "Fix or redirect these pages.");
  add("error", "brokenlinks", "Internal links pointing to broken pages", brokenLinks, "Update these links.");
  add("error", "notitle", "Missing title tag", ok.filter((p) => !p.title).map((p) => p.url));
  add("error", "noindex", "Pages blocked from Google (noindex)", ok.filter((p) => /noindex/i.test(p.robots || "")).map((p) => p.url), "Check these are meant to be hidden.");
  add("warning", "duptitle", "Duplicate titles", dup("title"));
  add("warning", "dupdesc", "Duplicate meta descriptions", dup("description"));
  add("warning", "nodesc", "Missing meta description", ok.filter((p) => !p.description).map((p) => p.url));
  add("warning", "noh1", "Missing H1 heading", ok.filter((p) => !p.h1count).map((p) => p.url));
  add("warning", "thin", "Thin content (under 300 words)", ok.filter((p) => p.words < 300).map((p) => `${p.url} (${p.words} words)`));
  add("warning", "longtitle", "Title too long (over 60 characters)", ok.filter((p) => (p.title || "").length > 60).map((p) => p.url));
  add("notice", "multih1", "More than one H1", ok.filter((p) => p.h1count > 1).map((p) => p.url));
  add("notice", "longdesc", "Meta description over 160 characters", ok.filter((p) => (p.description || "").length > 160).map((p) => p.url));
  add("notice", "canon", "Canonical points to another page", ok.filter((p) => p.canonical && p.canonical.replace(/\/$/, "") !== p.url.replace(/\/$/, "")).map((p) => `${p.url} → ${p.canonical}`));
  add("notice", "deep", "Deep pages (4+ clicks from home)", ok.filter((p) => p.depth >= 4).map((p) => p.url));
  const errorPages = new Set(), warnPages = new Set();
  list.forEach((i) => i.urls.forEach((u) => (i.sev === "error" ? errorPages : i.sev === "warning" ? warnPages : new Set()).add(u.split(" ")[0])));
  const health = pages.length ? Math.max(0, Math.round(100 - (errorPages.size / pages.length) * 70 - (warnPages.size / pages.length) * 30)) : 0;
  return { list, health, errors: list.filter((i) => i.sev === "error").reduce((n, i) => n + i.urls.length, 0), warnings: list.filter((i) => i.sev === "warning").reduce((n, i) => n + i.urls.length, 0) };
}

export default function Audit() {
  const { me, projects, project } = useSuite();
  const [limit, setLimit] = useState(100);
  const [state, setState] = useState(null); // { running, done, total, msg }
  const [run, setRun] = useState(null);     // latest saved run { summary, data }
  const [history, setHistory] = useState([]);
  const stop = useRef(false);

  useEffect(() => {
    if (!project) return;
    setRun(null);
    db(`projects/${project.id}/results/audit?full=1`).then((rs) => { setHistory(rs); if (rs[0]) setRun(rs[0]); }).catch(() => {});
  }, [project]);
  if (!projects || !project) return <NeedProject />;

  async function start() {
    stop.current = false;
    const host = project.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const home = "https://" + host + "/";
    setState({ running: true, done: 0, total: 1, msg: "Reading robots.txt and sitemaps…" });
    // Seeds: the home page plus the first sitemap URLs.
    let seeds = [home];
    try {
      const rb = await get("robots?host=" + encodeURIComponent(host));
      const queue = [...(rb.sitemaps || [])].slice(0, 4);
      for (let i = 0; i < queue.length && seeds.length < limit && i < 8; i++) {
        const sm = await get("sitemapfile?url=" + encodeURIComponent(queue[i]));
        (sm.sitemaps || []).slice(0, 3).forEach((s) => queue.push(s));
        seeds.push(...(sm.urls || []));
      }
    } catch (_) {}
    const seen = new Map(); // url -> depth
    const norm = (u) => { try { const x = new URL(u); x.hash = ""; return x.toString(); } catch (_) { return null; } };
    seeds.map(norm).filter(Boolean).forEach((u, i) => { if (!seen.has(u) && seen.size < limit) seen.set(u, i === 0 ? 0 : 1); });
    const pages = [];
    let frontier = [...seen.keys()];
    while (frontier.length && !stop.current) {
      const next = [];
      await pool(frontier, 6, async (u) => {
        if (stop.current) return;
        const d = await get("page?url=" + encodeURIComponent(u)).catch((e) => ({ ok: false, error: e.message }));
        const internal = [];
        (d.links || []).forEach((l) => {
          try { const x = new URL(l); if (!sameSite(x.hostname, host) || skipExt.test(x.pathname)) return; const n = norm(l); internal.push(n);
            if (!seen.has(n) && seen.size < limit) { seen.set(n, seen.get(u) + 1); next.push(n); } } catch (_) {}
        });
        pages.push({ url: u, ok: !!d.ok, status: d.status, error: d.ok ? "" : d.error, title: d.title || "", description: d.description || "", h1count: (d.h1 || []).length,
          canonical: d.canonical ? (() => { try { return new URL(d.canonical, u).toString(); } catch (_) { return d.canonical; } })() : "", robots: d.robots || "", words: d.words || 0, depth: seen.get(u), internal: [...new Set(internal)], links: internal.length });
        setState({ running: true, done: pages.length, total: seen.size, msg: "Checking " + u });
      });
      frontier = next;
    }
    const iss = findIssues(pages);
    const data = { pages: pages.map(({ internal, ...p }) => p), issues: iss.list };
    // Keep the saved run small enough for the database.
    data.pages.forEach((p) => { p.title = p.title.slice(0, 160); p.description = p.description.slice(0, 200); });
    const summary = { pages: pages.length, health: iss.health, errors: iss.errors, warnings: iss.warnings };
    const saved = { created_at: Date.now(), summary, data };
    setRun(saved); setState(null);
    if (canRun(me && me.role)) db(`projects/${project.id}/results/audit`, "POST", { summary, data }).then(() => db(`projects/${project.id}/results/audit`).then(setHistory)).catch(() => {});
  }

  const d = run && run.data;
  const prev = history[1];
  return (
    <>
      <div className="row"><h1>Site Audit</h1><span className="grow" />
        {state ? <button className="btn" onClick={() => { stop.current = true; }}>■ Stop</button> : canRun(me && me.role) && <>
          <select className="inp" style={{ width: "auto", padding: "9px 10px" }} value={limit} onChange={(e) => setLimit(+e.target.value)}>
            {[50, 100, 250, 500].map((n) => <option key={n} value={n}>Up to {n} pages</option>)}</select>
          <button className="btn primary" onClick={start}>{run ? "↻ Re-run audit" : "▶ Run audit"}</button></>}
      </div>
      <p className="muted" style={{ marginTop: 4 }}>Crawls {project.domain} from the home page and sitemaps, then checks every page for SEO problems.</p>
      {state && <div className="card" style={{ marginTop: 16 }}><b>Crawling… {state.done} of {state.total} pages</b><div className="prog" style={{ margin: "10px 0" }}><i style={{ width: Math.round(state.done / Math.max(1, state.total) * 100) + "%" }} /></div><div className="muted" style={{ fontSize: 13, wordBreak: "break-all" }}>{state.msg}</div></div>}
      {!run && !state && <div className="card empty" style={{ marginTop: 16 }}>No audit yet. Run one to see your site health.</div>}
      {run && !state && d && <>
        <div className="kpis">
          <Kpi n={run.summary.health + "%"} label={"site health" + (prev ? ` (was ${prev.summary.health}%)` : "")} cls={run.summary.health >= 80 ? "good" : run.summary.health >= 60 ? "mid" : "low"} />
          <Kpi n={fmt(run.summary.pages)} label="pages checked" />
          <Kpi n={fmt(run.summary.errors)} label="errors" cls="low" />
          <Kpi n={fmt(run.summary.warnings)} label="warnings" cls="mid" />
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Last run {when(run.created_at)}</p>
        <div className="card"><h3 style={{ marginBottom: 12 }}>Issues</h3>
          {!d.issues.length && <div className="empty">🎉 No issues found.</div>}
          {d.issues.map((i) => <details className="issue" key={i.id}><summary><i className={"sev " + i.sev} /><b style={{ flex: 1 }}>{i.label}</b><span className="pill">{i.urls.length}</span></summary>
            {i.tip && <p className="muted" style={{ padding: "0 14px 6px 34px", fontSize: 13 }}>{i.tip}</p>}
            <ul>{i.urls.slice(0, 300).map((u) => <li key={u}>{u}</li>)}</ul></details>)}
        </div>
        <div className="card"><div className="row" style={{ marginBottom: 10 }}><h3>Pages</h3><span className="grow" />
          <button className="btn sm ghost" onClick={() => downloadCsv("site-audit.csv", [["URL", "Status", "Title", "Description", "H1s", "Words", "Depth", "Internal links"], ...d.pages.map((p) => [p.url, p.ok ? p.status : p.error, p.title, p.description, p.h1count, p.words, p.depth, p.links])])}>⬇ CSV</button></div>
          <Table rows={d.pages} cols={[
            { h: "Page", v: (p) => p.url, r: (p) => <a href={p.url} target="_blank" rel="noopener noreferrer">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a> },
            { h: "Status", v: (p) => (p.ok ? p.status : p.error), r: (p) => <span className={"pill " + (p.ok ? "" : "low")}>{p.ok ? p.status : p.error}</span> },
            { h: "Title", v: (p) => p.title },
            { h: "Words", n: 1, v: (p) => p.words },
            { h: "Depth", n: 1, v: (p) => p.depth },
          ]} />
        </div>
      </>}
    </>
  );
}
