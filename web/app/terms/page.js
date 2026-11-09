import { SiteNav, SiteFoot } from "../../components/SiteNav";
export const metadata = { title: "Terms of Use" };

export default function Terms() {
  return (
    <div className="wrap">
      <SiteNav />
      <article className="prose">
        <h1>Terms of Use</h1>
        <p>By using SearchVerse (searchverse.in) you agree to these terms. Have your own terms reviewed before relying on them.</p>
        <h2>Accounts</h2>
        <p>Access is approved by your team admin. Keep your password private; you're responsible for activity on your account.</p>
        <h2>Fair use</h2>
        <p>Only scan websites you own or have permission to analyse. Don't use SearchVerse to overload, attack or scrape sites against their terms. The crawler respects robots.txt.</p>
        <h2>Data and results</h2>
        <p>Results come from public pages and free sources such as Google PageSpeed Insights and your own Search Console exports. They're estimates, provided as is, without warranty.</p>
        <h2>Changes</h2>
        <p>We may update these terms; the latest version is always on this page. Questions: <a href="mailto:hello@searchverse.in">hello@searchverse.in</a>.</p>
      </article>
      <SiteFoot />
    </div>
  );
}
