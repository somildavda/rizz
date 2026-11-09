"use client";
import { useEffect, useState } from "react";
import { useSuite, NeedProject, Kpi, Gauge } from "../../components/Suite";
import { db, fmt, when } from "../../lib/api";

export default function Overview() {
  const { projects, project } = useSuite();
  const [latest, setLatest] = useState([]);
  const [ov, setOv] = useState({ topics: [] });
  useEffect(() => {
    db("latest").then(setLatest).catch(() => {});
    db("overview").then(setOv).catch(() => {});
  }, []);
  if (!projects || !project) return <NeedProject />;

  const last = (pid, mod) => latest.find((r) => r.project_id === pid && r.module === mod);
  const topics = (pid) => ov.topics.filter((t) => t.project_id === pid).reduce((a, t) => ({ ...a, [t.status]: t.n }), {});
  const a = last(project.id, "audit"), s = last(project.id, "speed"), rk = last(project.id, "rankings"), tp = topics(project.id);

  return (
    <>
      <h1>{project.name}</h1>
      <p className="muted" style={{ marginTop: 4 }}>{project.domain} · {(project.competitors || []).length} competitors</p>
      <div className="kpis">
        <Kpi n={a ? a.summary.health + "%" : "—"} label="site health" cls={a ? (a.summary.health >= 80 ? "good" : a.summary.health >= 60 ? "mid" : "low") : ""} />
        <Kpi n={s && s.summary.performance != null ? s.summary.performance : "—"} label="speed score (mobile)" cls={s ? (s.summary.performance >= 90 ? "good" : s.summary.performance >= 50 ? "mid" : "low") : ""} />
        <Kpi n={rk ? fmt(rk.summary.clicks) : "—"} label="Google clicks" />
        <Kpi n={rk ? (rk.summary.position || 0).toFixed(1) : "—"} label="average position" />
        <Kpi n={fmt(tp.gap || 0)} label="topics to write" cls="low" />
      </div>
      <div className="grid2">
        <Module icon="🩺" name="Site Audit" href="/dashboard/audit" run={a} body={a && <>{fmt(a.summary.pages)} pages checked · <b style={{ color: "var(--low)" }}>{fmt(a.summary.errors)} errors</b> · {fmt(a.summary.warnings)} warnings</>} />
        <Module icon="🚀" name="Site Speed" href="/dashboard/speed" run={s} body={s && <div className="gauges" style={{ marginTop: 6 }}><Gauge v={s.summary.performance} label="Performance" /><Gauge v={s.summary.seo} label="SEO" /></div>} />
        <Module icon="📈" name="Rankings" href="/dashboard/rankings" run={rk} body={rk && <>{fmt(rk.summary.queries)} keywords · {fmt(rk.summary.top10)} in the top 10 · {fmt(rk.summary.striking)} quick wins</>} />
        <Module icon="🧩" name="Topic Planner" href={"/topic-planner/#/p/" + project.id} run={project.scans ? { created_at: project.last_scan } : null}
          body={project.scans ? <>{fmt(tp.gap || 0)} to write · {fmt((tp.planned || 0) + (tp.writing || 0))} in progress · {fmt(tp.published || 0)} published</> : null} />
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>All projects</h3>
        <div className="tw"><table className="t"><thead><tr><th>Project</th><th className="n">Health</th><th className="n">Speed</th><th className="n">Clicks</th><th className="n">Topics to write</th></tr></thead>
          <tbody>{projects.map((p) => { const A = last(p.id, "audit"), S = last(p.id, "speed"), R = last(p.id, "rankings"); return (
            <tr key={p.id}><td><b>{p.name}</b><div className="muted" style={{ fontSize: 13 }}>{p.domain}</div></td>
              <td className="n">{A ? A.summary.health + "%" : "—"}</td><td className="n">{S ? S.summary.performance : "—"}</td>
              <td className="n">{R ? fmt(R.summary.clicks) : "—"}</td><td className="n">{fmt(topics(p.id).gap || 0)}</td></tr>); })}</tbody></table></div>
      </div>
    </>
  );
}

function Module({ icon, name, href, run, body }) {
  return (
    <div className="card">
      <div className="row"><h3>{icon} {name}</h3><span className="grow" /><a className="btn sm" href={href}>{run ? "Open" : "Run first check"} →</a></div>
      <div style={{ marginTop: 10 }}>{run ? body : <span className="muted">Not run yet for this project.</span>}</div>
      {run && run.created_at && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Last run {when(run.created_at)}</div>}
    </div>
  );
}
