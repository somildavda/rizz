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

## Content Gap & Topic Planner (`/content-gap/`)
Page: `public/content-gap/index.html`. API: `src/content-gap.js`, served by this
Worker under `/api/cg/*`. The browser drives the crawl in small requests, so no
single Worker call goes over Cloudflare's subrequest limit. Everything uses free
sources. There are no paid APIs.

1. **Brand profile & knowledge base.** Name, domain, what it does, audience, products,
   topics to avoid, a pasted knowledge base and competitors. Profiles are saved in the browser.
2. **Whole-site crawl (Semrush-style).** For each site: subdomains from certificate logs
   (crt.sh) are checked to see which are live. The crawl starts from each home page, the
   folder you give (for example `/blog/`) and every sitemap URL, then follows internal
   links level by level until it finds no new pages or reaches the page limit. It
   respects robots.txt and records depth, inlinks and indexability. Pasted URLs are
   always crawled. Pages are fetched as HTML (no browser), which covers almost every
   blog. Sites that build their content with JavaScript in the browser would need
   Crawl4AI later.
3. **Topic and main keyword per page,** from the title, H1, slug, H2s and meta.
4. **Rankings (free, optional).**
   - Your site: a Google Search Console CSV export.
   - All sites: your own [SearXNG](https://github.com/searxng/searxng) instance
     (open source, `json` format enabled). It searches each main keyword and records
     each site's position in the top 20. Positions are approximate and there is no volume.
5. **Topic map & Topic score.** Pages from every site are clustered into topics, showing
   which topics competitors share and where you have none. Each topic gets a score from
   0 to 100: 40% brand relevance (against the profile and knowledge base), 25% gap,
   20% competitor demand and 15% rankability.
6. **AI topic ideas** (Gemini free tier, `/api/cg/gemini`). Gemini reads the profile,
   knowledge base, pages and scored gaps. It returns ranked topics with a primary
   keyword, topic, relevance and rank-potential scores, a title and an outline. Each
   primary keyword is checked against free Google Autocomplete (`/api/cg/suggest`).
7. **Supabase (optional, free tier).** Saves and reopens full reports. The table SQL is
   shown in the page.

Each table filters, sorts and exports to CSV. Keys go from the browser through the
Worker to Google, or straight to your Supabase project. They are never stored on a server.
