"use client";
// Shared state for the dashboard: who's signed in, the projects, and the chosen project.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, db, ROLE_NAMES } from "../lib/api";
import ThemeToggle from "./ThemeToggle";

const Ctx = createContext(null);
export const useSuite = () => useContext(Ctx);

const NAV = [
  ["Overview", "/dashboard", "🏠"],
  ["h", "Website"], ["Site Audit", "/dashboard/audit", "🩺"], ["Site Speed", "/dashboard/speed", "🚀"],
  ["h", "Search"], ["Rankings", "/dashboard/rankings", "📈"],
  ["h", "Content"], ["Topic Planner", "/topic-planner/", "🧩"],
];

export function SuiteShell({ children }) {
  const path = usePathname();
  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState(null);
  const [pid, setPid] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");

  const reload = useCallback(async () => {
    try {
      const list = await db("projects");
      setProjects(list);
      setPid((cur) => {
        let saved = cur; try { saved = saved || localStorage.getItem("sv-project") || ""; } catch (_) {}
        return list.some((p) => p.id === saved) ? saved : (list[0] && list[0].id) || "";
      });
    } catch (e) { setErr(e.message); setProjects([]); }
  }, []);
  useEffect(() => { api("/api/auth/me").then((d) => setMe(d.user)).catch(() => {}); reload(); }, [reload]);
  useEffect(() => { setOpen(false); }, [path]);
  const choose = (id) => { setPid(id); try { localStorage.setItem("sv-project", id); } catch (_) {} };
  const project = (projects || []).find((p) => p.id === pid) || null;
  const title = (NAV.find((n) => n[1] === path) || ["Dashboard"])[0];

  return (
    <Ctx.Provider value={{ me, projects, project, reload, choose }}>
      <div className="shell">
        <aside className={"side" + (open ? " open" : "")}>
          <a className="brand" href="/dashboard">🔭 Search<span className="grad">Verse</span></a>
          <label className="psel"><span className="navh" style={{ margin: "0 2px 6px", display: "block" }}>Project</span>
            <select className="inp" value={pid} onChange={(e) => choose(e.target.value)} style={{ padding: "9px 10px" }}>
              {!projects && <option>Loading…</option>}
              {projects && !projects.length && <option value="">No projects yet</option>}
              {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.domain}</option>)}
            </select>
          </label>
          <nav>
            {NAV.map((n, i) => n[0] === "h" ? <div className="navh" key={i}>{n[1]}</div>
              : <a key={n[1]} href={n[1]} className={path === n[1] ? "on" : ""}>{n[2]} {n[0]}</a>)}
            <div className="navh">Team</div>
            <a href="/topic-planner/#/new">➕ New project</a>
            {me && ["admin", "owner"].includes(me.role) && <a href="/access" className={path === "/access" ? "on" : ""}>🛡️ Access Center</a>}
          </nav>
          <div className="me">
            {me && <span><b style={{ color: "var(--text)" }}>{me.name}</b><br />{ROLE_NAMES[me.role] || me.role}</span>}
            <a className="btn sm ghost" href="/logout">Sign out</a>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="btn sm ghost menu" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
            <b>{title}</b>{project && <span className="muted">· {project.domain}</span>}
            <span className="grow" /><ThemeToggle />
          </header>
          {err ? <div className="card"><h3>Can't reach the database</h3><p className="muted">{err}</p></div> : children}
        </div>
      </div>
    </Ctx.Provider>
  );
}

// Shown when a module needs a project and there isn't one.
export function NeedProject() {
  const { projects } = useSuite();
  if (!projects) return <div className="card empty">Loading…</div>;
  return (
    <div className="card empty">
      <div style={{ fontSize: 36 }}>📁</div>
      <h3 style={{ margin: "8px 0" }}>Create your first project</h3>
      <p>A project is your website plus your competitors. Every tool uses it.</p>
      <a className="btn primary" style={{ marginTop: 14 }} href="/topic-planner/#/new">＋ New project</a>
    </div>
  );
}

export function Kpi({ n, label, cls }) {
  return <div className={"kpi " + (cls || "")}><b>{n}</b><span>{label}</span></div>;
}

export function Gauge({ v, label }) {
  const c = v == null ? "var(--muted)" : v >= 90 ? "var(--good)" : v >= 50 ? "var(--mid)" : "var(--low)";
  return <div><div className="gauge" style={{ "--v": v || 0, "--c": c }}><b>{v == null ? "—" : v}</b></div><span>{label}</span></div>;
}

// Small sortable table.
export function Table({ cols, rows, limit = 200 }) {
  const [sort, setSort] = useState(null);
  const [q, setQ] = useState("");
  let rs = rows.filter((r) => !q || cols.some((c) => String(c.v(r) ?? "").toLowerCase().includes(q.toLowerCase())));
  if (sort) { const c = cols[sort.i]; rs = [...rs].sort((a, b) => { const x = c.v(a) ?? -Infinity, y = c.v(b) ?? -Infinity; return (x > y ? 1 : x < y ? -1 : 0) * sort.d; }); }
  return (
    <div>
      {rows.length > 10 && <input className="inp" style={{ maxWidth: 320, marginBottom: 10, padding: "8px 12px" }} placeholder="🔎 Search" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="tw"><table className="t">
        <thead><tr>{cols.map((c, i) => <th key={i} className={c.n ? "n" : ""} onClick={() => setSort({ i, d: sort && sort.i === i ? -sort.d : -1 })}>{c.h}{sort && sort.i === i ? (sort.d < 0 ? " ↓" : " ↑") : ""}</th>)}</tr></thead>
        <tbody>{rs.slice(0, limit).map((r, k) => <tr key={k}>{cols.map((c, i) => <td key={i} className={c.n ? "n" : ""}>{c.r ? c.r(r) : (c.v(r) ?? "—")}</td>)}</tr>)}</tbody>
      </table></div>
      {rs.length > limit && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Showing {limit} of {rs.length}. Download the CSV for all.</p>}
      {!rs.length && <div className="empty">Nothing to show.</div>}
    </div>
  );
}
