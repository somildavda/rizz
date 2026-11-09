import ThemeToggle from "./ThemeToggle";

export function SiteNav() {
  return (
    <header className="nav">
      <a className="brand" href="/">🔭 Search<span className="grad">Verse</span></a>
      <span className="grow" />
      <a className="btn sm ghost" href="/#tools">Tools</a>
      <ThemeToggle />
      <a className="btn sm" href="/login">Sign in</a>
      <a className="btn sm primary" href="/login?tab=request">Request access</a>
    </header>
  );
}

export function SiteFoot() {
  return (
    <footer className="foot">
      <span>© {new Date().getFullYear()} SearchVerse</span>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="mailto:hello@searchverse.in">hello@searchverse.in</a>
    </footer>
  );
}
