import { SiteNav, SiteFoot } from "../../components/SiteNav";
export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <div className="wrap">
      <SiteNav />
      <article className="prose">
        <h1>Privacy Policy</h1>
        <p>This page explains what SearchVerse (searchverse.in) stores and why. Have your own policy reviewed before relying on it.</p>
        <h2>What we store</h2>
        <ul>
          <li>Your account: name, email, a salted hash of your password (never the password itself), your role and sign-in times.</li>
          <li>Your work: projects, crawl results, speed tests, Search Console files you upload, and your topic plan.</li>
        </ul>
        <h2>Where it's stored</h2>
        <p>On Cloudflare's network, in databases that only this service can reach. Connections are encrypted with HTTPS.</p>
        <h2>Emails</h2>
        <p>We email you about your account: when you request access, when it's approved or changed. We don't send marketing emails or sell your data.</p>
        <h2>Cookies</h2>
        <p>One sign-in cookie (HttpOnly, Secure), and your light/dark theme choice in your browser.</p>
        <h2>Deleting your data</h2>
        <p>Email <a href="mailto:hello@searchverse.in">hello@searchverse.in</a> and we'll delete your account and its data.</p>
      </article>
      <SiteFoot />
    </div>
  );
}
