"use client";
import { useEffect, useState } from "react";
import { SiteNav } from "../../components/SiteNav";

export default function Login() {
  const [up, setUp] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/dashboard");
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("tab") === "request") setUp(true);
    const n = q.get("next"); if (n && /^\/(?!\/)/.test(n)) setNext(n);
  }, []);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const f = Object.fromEntries(new FormData(e.target));
    const r = await fetch(up ? "/api/auth/signup" : "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (d.ok) { location.href = d.admin ? "/access" : next; return; }
    if (d.pending) { setMsg({ ok: true, t: "Thanks! Your request was sent. We've emailed you, and we'll email again as soon as it's approved." }); e.target.reset(); return; }
    setMsg({ t: d.error || "Something went wrong." });
  }

  return (
    <div className="wrap">
      <SiteNav />
      <div className="authbox">
        <h1 style={{ fontSize: 26, textAlign: "center" }}>{up ? "Request access" : "Welcome back"}</h1>
        <p className="muted" style={{ textAlign: "center", marginTop: 6 }}>{up ? "Your team admin approves new members." : "Sign in to SearchVerse."}</p>
        <div className="tabs2">
          <button type="button" className={up ? "" : "on"} onClick={() => { setUp(false); setMsg(null); }}>Sign in</button>
          <button type="button" className={up ? "on" : ""} onClick={() => { setUp(true); setMsg(null); }}>Request access</button>
        </div>
        <form onSubmit={submit} key={up ? "up" : "in"}>
          {up && <><label className="fld" htmlFor="name">Your name</label><input className="inp" id="name" name="name" autoComplete="name" required /></>}
          <label className="fld" htmlFor="email">{up ? "Work email" : "Email"}</label>
          <input className="inp" id="email" name="email" type="email" autoComplete="email" required />
          <label className="fld" htmlFor="password">{up ? "Choose a password" : "Password"}</label>
          <input className="inp" id="password" name="password" type="password" minLength={up ? 8 : undefined} autoComplete={up ? "new-password" : "current-password"} placeholder={up ? "At least 8 characters" : ""} required />
          {up && <><label className="fld" htmlFor="note">Why do you need access? (optional)</label><textarea className="inp" id="note" name="note" rows={2} /></>}
          <button className="btn primary" style={{ width: "100%", marginTop: 20 }} disabled={busy}>{busy ? "Please wait…" : up ? "Request access →" : "Sign in →"}</button>
        </form>
        {msg && <div className={"msg " + (msg.ok ? "ok" : "err")}>{msg.t}</div>}
      </div>
    </div>
  );
}
