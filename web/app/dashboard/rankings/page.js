"use client";
import { useEffect, useState } from "react";
import { useSuite, NeedProject, Kpi, Table } from "../../../components/Suite";
import { db, canRun, fmt, when, parseCsv, downloadCsv } from "../../../lib/api";

// Reads a Search Console "Queries.csv" (Performance → Export → CSV, inside the zip).
function readQueries(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("That file is empty.");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const cq = col("query", "queries"), cc = col("clicks"), ci = col("impressions"), cp = col("position");
  if (cq < 0 || cp < 0) throw new Error("Couldn't find Query and Position columns. Use Queries.csv from the Search Console export.");
  const n = (s) => Number(String(s || "").replace(/[%,\s]/g, "")) || 0;
  return rows.slice(1).map((r) => ({ q: r[cq], clicks: n(r[cc]), imp: n(r[ci]), pos: Math.round(n(r[cp]) * 10) / 10 }))
    .filter((r) => r.q).map((r) => ({ ...r, ctr: r.imp ? Math.round((r.clicks / r.imp) * 1000) / 10 : 0 }));
}

export default function Rankings() {
  const { me, projects, project } = useSuite();
  const [rows, setRows] = useState(null);
  const [prev, setPrev] = useState(null);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("wins");

  async function load() {
    const rs = await db(`projects/${project.id}/results/rankings?full=1`).catch(() => []);
    setRows(rs[0] ? rs[0].data : null); setMeta(rs[0] || null);
    // The previous run, for "what moved".
    if (rs[1]) {
      const all = await db(`projects/${project.id}/results/rankings`).catch(() => []);
      setPrev(all[1] ? all[1].summary : null);
    } else setPrev(null);
  }
  useEffect(() => { if (project) { setRows(null); load(); } }, [project]); // eslint-disable-line
  if (!projects || !project) return <NeedProject />;

  async function upload(e) {
    setErr("");
    try {
      const f = e.target.files[0]; if (!f) return;
      const data = readQueries(await f.text()).sort((a, b) => b.imp - a.imp).slice(0, 5000);
      const sum = (k) => data.reduce((n, r) => n + r[k], 0), imp = sum("imp");
      const summary = {
        file: f.name, queries: data.length, clicks: sum("clicks"), impressions: imp,
        position: imp ? data.reduce((n, r) => n + r.pos * r.imp, 0) / imp : 0,
        top3: data.filter((r) => r.pos <= 3).length, top10: data.filter((r) => r.pos <= 10).length,
        striking: data.filter((r) => r.pos > 3 && r.pos <= 20 && r.imp >= 10).length,
        positions: Object.fromEntries(data.slice(0, 1000).map((r) => [r.q, r.pos])), // for comparing next time
      };
      if (!canRun(me && me.role)) { setRows(data); setMeta({ created_at: Date.now(), summary }); return; }
      await db(`projects/${project.id}/results/rankings`, "POST", { summary, data });
      await load();
    } catch (x) { setErr(x.message); }
    e.target.value = "";
  }

  const s = meta && meta.summary;
  const moved = rows && prev && prev.positions ? rows.filter((r) => prev.positions[r.q] != null).map((r) => ({ ...r, was: prev.positions[r.q], change: Math.round((prev.positions[r.q] - r.pos) * 10) / 10 })).filter((r) => Math.abs(r.change) >= 1) : [];
  const views = {
    wins: { label: "⚡ Quick wins", tip: "Position 4–20 with real impressions: a small push gets these onto page 1 or into the top 3.", data: (rows || []).filter((r) => r.pos > 3 && r.pos <= 20 && r.imp >= 10).sort((a, b) => b.imp - a.imp) },
    ctr: { label: "👀 Low click rate", tip: "Lots of impressions but few clicks: rewrite the title and meta description.", data: (rows || []).filter((r) => r.imp >= 100 && r.pos <= 10 && r.ctr < 2).sort((a, b) => b.imp - a.imp) },
    moved: { label: "↕️ What moved", tip: "Position change since your previous upload (positive = moved up).", data: moved.sort((a, b) => b.change - a.change) },
    all: { label: "All keywords", data: rows || [] },
  };
  const v = views[tab];
  const buckets = rows ? [["1–3", rows.filter((r) => r.pos <= 3).length], ["4–10", rows.filter((r) => r.pos > 3 && r.pos <= 10).length], ["11–20", rows.filter((r) => r.pos > 10 && r.pos <= 20).length], ["21–50", rows.filter((r) => r.pos > 20 && r.pos <= 50).length], ["51+", rows.filter((r) => r.pos > 50).length]] : [];
  const maxB = Math.max(1, ...buckets.map((b) => b[1]));

  return (
    <>
      <div className="row"><h1>Rankings</h1><span className="grow" />
        <label className="btn primary" style={{ margin: 0 }}>⬆ Upload Search Console file<input type="file" accept=".csv,text/csv" hidden onChange={upload} /></label></div>
      <p className="muted" style={{ marginTop: 4 }}>In Search Console: Performance → set the date range → Export → Download CSV. Unzip it and upload <b>Queries.csv</b>. Upload again each month to see what moved.</p>
      {err && <div className="msg err">{err}</div>}
      {!rows && <div className="card empty" style={{ marginTop: 16 }}>No rankings yet for this project.</div>}
      {rows && s && <>
        <div className="kpis">
          <Kpi n={fmt(s.clicks)} label={"clicks" + (prev ? ` (was ${fmt(prev.clicks)})` : "")} />
          <Kpi n={fmt(s.impressions)} label="impressions" />
          <Kpi n={(s.position || 0).toFixed(1)} label={"average position" + (prev ? ` (was ${(prev.position || 0).toFixed(1)})` : "")} />
          <Kpi n={fmt(s.top10)} label="keywords in top 10" cls="good" />
          <Kpi n={fmt(s.striking)} label="quick wins" cls="mid" />
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{s.file} · uploaded {when(meta.created_at)}</p>
        <div className="card"><h3 style={{ marginBottom: 12 }}>Where your keywords rank</h3>
          <div className="bars">{buckets.map(([l, n]) => <div key={l} style={{ height: (n / maxB) * 100 + "%" }} data-t={`Position ${l}: ${n}`} />)}</div>
          <div className="row" style={{ justifyContent: "space-around", fontSize: 12, marginTop: 6 }} >{buckets.map(([l, n]) => <span key={l} className="muted">{l} · {n}</span>)}</div></div>
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>{Object.entries(views).map(([k, x]) => <button key={k} className={"btn sm " + (tab === k ? "primary" : "ghost")} onClick={() => setTab(k)}>{x.label} ({x.data.length})</button>)}
            <span className="grow" /><button className="btn sm ghost" onClick={() => downloadCsv(`rankings-${tab}.csv`, [["Query", "Clicks", "Impressions", "CTR %", "Position"], ...v.data.map((r) => [r.q, r.clicks, r.imp, r.ctr, r.pos])])}>⬇ CSV</button></div>
          {v.tip && <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{v.tip}</p>}
          {tab === "moved" && !prev ? <div className="empty">Upload a second file later to see what moved.</div> :
            <Table rows={v.data} cols={[
              { h: "Keyword", v: (r) => r.q },
              { h: "Clicks", n: 1, v: (r) => r.clicks, r: (r) => fmt(r.clicks) },
              { h: "Impressions", n: 1, v: (r) => r.imp, r: (r) => fmt(r.imp) },
              { h: "CTR", n: 1, v: (r) => r.ctr, r: (r) => r.ctr + "%" },
              { h: "Position", n: 1, v: (r) => r.pos },
              ...(tab === "moved" ? [{ h: "Change", n: 1, v: (r) => r.change, r: (r) => <span className={"pill " + (r.change > 0 ? "good" : "low")}>{r.change > 0 ? "▲ " : "▼ "}{Math.abs(r.change)}</span> }] : []),
            ]} />}
        </div>
      </>}
    </>
  );
}
