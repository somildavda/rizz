"use client";
import { useEffect, useState } from "react";
import { useSuite, NeedProject, Gauge } from "../../../components/Suite";
import { api, db, canRun, when } from "../../../lib/api";

const CWV = [
  ["lcp", "Largest Contentful Paint", (v) => (v / 1000).toFixed(1) + " s"],
  ["inp", "Interaction to Next Paint", (v) => v + " ms"],
  ["cls", "Cumulative Layout Shift", (v) => (v / 100).toFixed(2)],
  ["fcp", "First Contentful Paint", (v) => (v / 1000).toFixed(1) + " s"],
  ["ttfb", "Time to First Byte", (v) => (v / 1000).toFixed(2) + " s"],
];
const CAT = { FAST: ["Good", "good"], AVERAGE: ["Needs work", "mid"], SLOW: ["Poor", "low"] };

export default function Speed() {
  const { me, projects, project } = useSuite();
  const [url, setUrl] = useState("");
  const [strategy, setStrategy] = useState("mobile");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!project) return;
    setUrl("https://" + project.domain.replace(/^https?:\/\//, "").replace(/\/$/, "") + "/");
    setRes(null);
    db(`projects/${project.id}/results/speed?full=1`).then((rs) => { setHistory(rs); if (rs[0] && rs[0].data) setRes(rs[0].data); }).catch(() => {});
  }, [project]);
  if (!projects || !project) return <NeedProject />;

  async function test() {
    setBusy(true); setErr("");
    try {
      const d = await api(`/api/suite/psi?url=${encodeURIComponent(url)}&strategy=${strategy}`);
      setRes(d);
      if (canRun(me && me.role)) {
        await db(`projects/${project.id}/results/speed`, "POST", { summary: { url: d.url, strategy, ...d.scores }, data: d });
        setHistory(await db(`projects/${project.id}/results/speed`));
      }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const trend = history.filter((h) => h.summary.performance != null).slice(0, 12).reverse();
  return (
    <>
      <h1>Site Speed</h1>
      <p className="muted" style={{ marginTop: 4 }}>Google PageSpeed Insights: real-user Core Web Vitals plus a Lighthouse lab test. A test takes 20–60 seconds.</p>
      <div className="card row" style={{ marginTop: 16 }}>
        <input className="inp" style={{ flex: 1, minWidth: 220 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/page" />
        <select className="inp" style={{ width: "auto" }} value={strategy} onChange={(e) => setStrategy(e.target.value)}><option value="mobile">📱 Mobile</option><option value="desktop">🖥️ Desktop</option></select>
        <button className="btn primary" onClick={test} disabled={busy}>{busy ? "Testing…" : "▶ Test speed"}</button>
      </div>
      {err && <div className="msg err">{err}</div>}
      {!res && !busy && <div className="card empty">No test yet for this project.</div>}
      {res && <>
        <div className="card"><div className="row" style={{ marginBottom: 14 }}><h3>Scores</h3><span className="muted" style={{ fontSize: 13, wordBreak: "break-all" }}>{res.url} · {res.strategy} · {when(res.fetched)}</span></div>
          <div className="gauges"><Gauge v={res.scores.performance} label="Performance" /><Gauge v={res.scores.accessibility} label="Accessibility" /><Gauge v={res.scores.bestPractices} label="Best practices" /><Gauge v={res.scores.seo} label="SEO" /></div></div>
        <div className="grid2">
          <div className="card"><h3 style={{ marginBottom: 6 }}>Core Web Vitals (real users)</h3>
            {Object.values(res.field).every((x) => !x) ? <p className="muted">Google doesn't have enough real-user data for this page yet. Use the lab results.</p> :
              <table className="t"><tbody>{CWV.map(([k, label, f]) => res.field[k] && <tr key={k}><td>{label}</td><td className="n">{f(res.field[k].p75)}</td><td>{CAT[res.field[k].category] ? <span className={"pill " + CAT[res.field[k].category][1]}>{CAT[res.field[k].category][0]}</span> : null}</td></tr>)}</tbody></table>}
          </div>
          <div className="card"><h3 style={{ marginBottom: 6 }}>Lab test</h3>
            <table className="t"><tbody>{[["fcp", "First Contentful Paint"], ["lcp", "Largest Contentful Paint"], ["tbt", "Total Blocking Time"], ["cls", "Cumulative Layout Shift"], ["si", "Speed Index"]].map(([k, l]) => res.lab[k] && <tr key={k}><td>{l}</td><td className="n"><span className={"pill " + (res.lab[k].score >= 0.9 ? "good" : res.lab[k].score >= 0.5 ? "mid" : "low")}>{res.lab[k].value}</span></td></tr>)}</tbody></table>
          </div>
        </div>
        <div className="card"><h3 style={{ marginBottom: 6 }}>What to fix first</h3>
          {!res.opportunities.length ? <p className="muted">No big savings found. 🎉</p> :
            <table className="t"><tbody>{res.opportunities.map((o) => <tr key={o.title}><td>{o.title}</td><td className="n">{o.savings ? "saves ~" + (o.savings / 1000).toFixed(1) + " s" : o.value}</td></tr>)}</tbody></table>}
        </div>
      </>}
      {trend.length > 1 && <div className="card"><h3 style={{ marginBottom: 12 }}>Performance over time</h3>
        <div className="bars">{trend.map((h) => <div key={h.id} style={{ height: h.summary.performance + "%" }} data-t={`${h.summary.performance} · ${h.summary.strategy} · ${new Date(h.created_at).toLocaleDateString()}`} />)}</div></div>}
    </>
  );
}
