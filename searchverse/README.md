# SearchVerse hub

One self-contained page (`public/index.html`): logo, styles, tool list and
routing are all inside it. Served by a Cloudflare Worker (`src/index.js`) that
also proxies every module under the same address:

- `/performance/` → searchverse.somildavda.workers.dev
- `/speed/` → searchverse-psi.shred-app.workers.dev
- `/youtube/` → searchverse-youtube.searchverse-infidigit.workers.dev

- `/content-gap/` → Content Gap Report, built into this Worker (see below)

The Google Apps Script workspace can't be proxied (Google sign-in), so it
still opens on script.google.com.

Routes (all on the same page):
- `#/` — homepage
- `#/tools/<id>` — a module's dedicated view
- `#/tools/<id>/launch` — the module opened full screen inside SearchVerse

## Add a module
Add one object to `window.SV_TOOLS` near the bottom of `public/index.html`.
To serve it under the SearchVerse address, also add it to `MODULES` in
`src/index.js` and set its `url` to `/<id>/`.

## Connect to Cloudflare (auto-deploy from GitHub)
Option A — Cloudflare dashboard (no secrets needed):
1. Workers & Pages → Create → Import a repository → pick `somildavda/rizz`.
2. Root directory: `searchverse`. Build command: leave empty. Deploy command: `npx wrangler deploy`.
3. Production branch: `main`. Every push then redeploys.

Option B — GitHub Actions: add repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`; `.github/workflows/searchverse-deploy.yml` deploys on
pushes to `main` that touch `searchverse/`.

Manual: `cd searchverse && npx wrangler login && npx wrangler deploy`.

## Topic Planner (`/content-gap/`)
A step-by-step tool. Make a project for your brand, add your competitors (each with a
niche), and it reads every site, compares topics, and tells you what to write next.
Everything uses free sources.

```
public/content-gap/
  index.html        page shell
  css/app.css       styles
  js/app.js         projects, 5-step setup, scan screen, results dashboard
  js/engine.js      crawler, keyword extraction, rankings, gaps, topic scores
  js/ai.js          Gemini plan (Koray's framework), Autocomplete, SERP snapshot
  js/ui.js          table, score bars, toasts, database client
src/content-gap.js  /api/cg/*: subdomains, robots, sitemaps, page fetch, suggest, serp, gemini
src/db.js           /api/cg/db/*: project database (SQLite Durable Object)
```

**Flow:** Projects → 1 Your brand (incl. knowledge base) → 2 Competitors (one per row,
with a niche) → 3 What to scan (whole site / one folder / quick look, up to 50,000 pages
per site) → 4 Power-ups → 5 Review → Scan → Results.

**Crawling.** For each site, subdomains come from certificate logs (crt.sh). Each is
checked to see whether it's live, its robots.txt and the full sitemap tree are read,
and then the crawl follows internal links level by level from the home page, folder and
sitemaps. It respects robots.txt and records depth and inlinks. Listing pages (blog
index, pagination, tags) are used to find articles but aren't topics. Pages are
fetched as HTML, so sites that build their content with JavaScript in the browser
aren't fully read.

**Topic score (0–100).** Pages from every site are clustered into topics:
40% brand relevance (topic words vs. the profile and knowledge base), 25% gap,
20% competitor interest and 15% chance to rank.

**Koray's framework.** The topical map shows the source context, the central entity and
the central search intent. Topics are split into a core section (about what you sell)
and an outer section (supporting topics that link back to the core). With a free
Gemini key, the AI builds the map: a primary keyword, title, outline and link target
for each topic, with keywords checked against Google Autocomplete. Without a key,
topics that share words with your products list count as core.

**Rankings (optional, free).** Search Console CSV for your own site. A self-hosted
SearXNG for everyone's approximate top-20 positions and live SERP snapshots.

**Database.** A SQLite Durable Object is declared in `wrangler.jsonc` and created on
deploy (it works on the free plan). It stores projects, every scan's pages, and the topic
backlog with statuses (to write / planned / writing / published / covered / not for us).
Each re-scan marks gaps you've covered (with date and URL), keeps statuses you set by
hand, and lists new competitor articles. Access uses a workspace key generated in the
browser (Settings → copy it to other devices). API keys stay in the browser.
