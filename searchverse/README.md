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

## Content Gap Report (`/content-gap/`)
Page: `public/content-gap/index.html`. API: `src/content-gap.js`, served by this
Worker under `/api/cg/*`. The browser drives the crawl in small requests, so no
single Worker call goes over Cloudflare's subrequest limit.

For your domain and each competitor it:
1. Finds subdomains from certificate-transparency logs (crt.sh), skips mail/dev/CDN
   hosts, checks which ones serve pages and merges `www`/apex duplicates.
2. Gathers URLs from `robots.txt` sitemaps (or home-page links when there are none) and
   crawls a page budget spread across subdomains and site sections.
3. Pulls each page's title, meta, H1–H3 and text, and works out its **topic**
   (subdomain + section) and **main keyword** (weighted phrases from the title, H1,
   slug, H2s and meta).
4. With a DataForSEO login (optional, entered in the page), fetches up to 1,000
   **ranking keywords** per site (DataForSEO Labs `ranked_keywords`, covers all
   subdomains). It maps them to the crawled pages, and a page's best-ranking keyword
   becomes its main keyword.
5. Builds the **keyword gap** (missing / weak / shared / unique, with an opportunity
   score) and the **topic gap** (competitor pages with no matching page of yours).

Each table filters, sorts and exports to CSV. The DataForSEO login goes from the
browser through the Worker to api.dataforseo.com and is never stored on the server.
