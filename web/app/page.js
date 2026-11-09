import { SiteNav, SiteFoot } from "../components/SiteNav";

const TOOLS = [
  ["🩺", "Site Audit", "Crawls your site like a search engine and lists every broken page, missing title, duplicate description, thin page and noindex tag, with a health score."],
  ["🚀", "Site Speed", "Core Web Vitals and Lighthouse scores for mobile and desktop, with the fixes that save the most time."],
  ["📈", "Rankings", "Bring in your Search Console data to see clicks, positions, quick-win keywords and what moved since last time."],
  ["🧩", "Topic Planner", "Compares your site with competitors, finds the topics you're missing, scores them and writes the briefs."],
  ["📁", "Projects", "One project per brand, shared by every tool, so your audits, speed tests, rankings and content plan live together."],
  ["🛡️", "Team access", "Invite your team, approve requests and choose who can run scans, edit plans or only view."],
];

export default function Home() {
  return (
    <div className="wrap">
      <SiteNav />
      <section className="hero">
        <h1>Your whole SEO workflow, <span className="grad">in one place</span></h1>
        <p>SearchVerse audits your site, tests its speed, tracks your Google rankings and plans the content to write next, for your whole team.</p>
        <div className="cta">
          <a className="btn primary" href="/login?tab=request">Request access →</a>
          <a className="btn" href="/login">Sign in</a>
        </div>
      </section>
      <h2 id="tools" style={{ textAlign: "center", fontSize: 28 }}>Everything you need to grow search traffic</h2>
      <div className="feats">
        {TOOLS.map(([ic, name, desc]) => (
          <div className="feat" key={name}><div className="ic">{ic}</div><h3>{name}</h3><p>{desc}</p></div>
        ))}
      </div>
      <h2 style={{ textAlign: "center", fontSize: 28, marginBottom: 20 }}>How it works</h2>
      <div className="steps">
        <div className="step"><b>1. Create a project</b><span className="muted">Add your domain and your competitors.</span></div>
        <div className="step"><b>2. Run the tools</b><span className="muted">Audit, speed test, rankings import and topic scan.</span></div>
        <div className="step"><b>3. Fix and write</b><span className="muted">Work through the prioritised list with your team.</span></div>
        <div className="step"><b>4. Re-run and compare</b><span className="muted">Every run is saved, so you see what changed.</span></div>
      </div>
      <SiteFoot />
    </div>
  );
}
