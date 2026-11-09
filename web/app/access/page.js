"use client";
import { useEffect, useState } from "react";
import { useSuite, Kpi } from "../../components/Suite";
import { api, db, ROLE_NAMES, when } from "../../lib/api";

export default function Access() {
  const { me } = useSuite();
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const load = () => api("/api/access/users").then(setUsers).catch((e) => setNote(e.message));
  useEffect(() => { load(); }, []);
  if (!me) return <div className="card empty">Loading…</div>;

  const act = async (path, body, done) => {
    try { await api(path, "POST", body); setNote(done); load(); } catch (e) { setNote(e.message); }
  };
  const roles = me.role === "owner" ? ["admin", "manager", "member", "viewer"] : ["manager", "member", "viewer"];
  const editable = (u) => u.role !== "owner" && u.id !== me.id && (me.role === "owner" || u.role !== "admin");
  const pend = users.filter((u) => u.status === "pending");
  const rest = users.filter((u) => u.status !== "pending" && (!q || (u.name + " " + u.email).toLowerCase().includes(q.toLowerCase())));

  async function restore(e) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(data.projects)) throw new Error("That file isn't a SearchVerse backup.");
      const r = await db("import", "POST", data);
      setNote(`Imported ${r.moved} project(s)${r.skipped ? `, ${r.skipped} already here` : ""}.`);
    } catch (x) { setNote(x.message); }
    e.target.value = "";
  }

  return (
    <>
      <h1>Access Center</h1>
      <p className="muted" style={{ marginTop: 4 }}>Approve requests and choose what each person can do. Everyone gets an email from SearchVerse when their access changes.</p>
      {note && <div className="msg ok" onClick={() => setNote("")}>{note}</div>}
      <div className="kpis">
        <Kpi n={users.filter((u) => u.status === "approved").length} label="people with access" />
        <Kpi n={pend.length} label="waiting for approval" cls={pend.length ? "mid" : ""} />
      </div>
      <div className="card"><h3 style={{ marginBottom: 10 }}>⏳ Access requests</h3>
        {!pend.length && <div className="muted">No one is waiting.</div>}
        {pend.map((u) => <PendingRow key={u.id} u={u} roles={roles} act={act} />)}
      </div>
      <div className="card"><div className="row" style={{ marginBottom: 10 }}><h3>👥 People</h3><span className="grow" /><input className="inp" style={{ maxWidth: 260, padding: "8px 12px" }} placeholder="🔎 Name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="tw"><table className="t"><thead><tr><th>Person</th><th>Access</th><th>Role</th><th>Last sign-in</th><th /></tr></thead><tbody>
          {rest.map((u) => <tr key={u.id}>
            <td><b>{u.name}</b>{u.id === me.id && <span className="muted"> (you)</span>}<div className="muted" style={{ fontSize: 13 }}>{u.email}</div></td>
            <td><span className={"pill " + (u.status === "approved" ? "good" : "low")}>{u.status}</span></td>
            <td>{editable(u) && u.status === "approved" ? <select className="inp" style={{ width: "auto", padding: "6px 8px" }} value={u.role} onChange={(e) => act("/api/access/user", { id: u.id, role: e.target.value }, "Role updated, and they've been emailed.")}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select> : ROLE_NAMES[u.role] || u.role}</td>
            <td>{when(u.last_login)}</td>
            <td style={{ whiteSpace: "nowrap" }}>{editable(u) && <>
              {u.status === "approved" ? <button className="btn sm" onClick={() => act("/api/access/user", { id: u.id, status: "rejected" }, "Access removed.")}>Block</button>
                : <button className="btn sm" onClick={() => act("/api/access/user", { id: u.id, status: "approved" }, "Access restored.")}>Restore</button>}{" "}
              <button className="btn sm" onClick={() => confirm(`Remove ${u.name} completely?`) && act("/api/access/remove", { id: u.id }, "Removed.")}>Remove</button></>}</td>
          </tr>)}
        </tbody></table></div>
      </div>
      <div className="card"><h3 style={{ marginBottom: 8 }}>🔑 Roles</h3>
        <p className="muted" style={{ lineHeight: 1.7 }}><b>Owner</b>: everything, including team admins and backups. <b>Team admin</b>: approve people and set roles. <b>Project manager</b>: create, edit and scan projects. <b>Member</b>: run audits and speed tests, update topics. <b>Viewer</b>: look only.</p></div>
      {me.role === "owner" && <div className="card row"><div style={{ flex: 1, minWidth: 220 }}><h3>💾 Backups</h3><p className="muted" style={{ fontSize: 14 }}>Download every project, or bring in a backup from the old Topic Planner.</p></div>
        <a className="btn" href="/api/cg/db/export" download="searchverse-backup.json">⬇ Download backup</a>
        <label className="btn" style={{ margin: 0 }}>⬆ Restore / import<input type="file" accept=".json" hidden onChange={restore} /></label></div>}
    </>
  );
}

function PendingRow({ u, roles, act }) {
  const [role, setRole] = useState("member");
  return (
    <div className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ flex: 1, minWidth: 220 }}><b>{u.name}</b> <span className="muted">{u.email}</span>{u.note && <div className="muted" style={{ fontSize: 13 }}>“{u.note}”</div>}<div className="muted" style={{ fontSize: 12 }}>Asked {when(u.created_at)}</div></div>
      <select className="inp" style={{ width: "auto", padding: "6px 8px" }} value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select>
      <button className="btn sm primary" onClick={() => act("/api/access/user", { id: u.id, status: "approved", role }, `${u.name} approved and emailed.`)}>Approve</button>
      <button className="btn sm" onClick={() => act("/api/access/user", { id: u.id, status: "rejected" }, "Request rejected.")}>Reject</button>
    </div>
  );
}
