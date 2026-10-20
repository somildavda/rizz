# SearchVerse hub

One self-contained page (`public/index.html`): logo, styles, tool list and
routing are all inside it. Served by a Cloudflare Worker (`src/index.js`) that
also proxies every module under the same address:

- `/performance/` → searchverse.somildavda.workers.dev
- `/speed/` → searchverse-psi.shred-app.workers.dev
- `/youtube/` → searchverse-youtube.searchverse-infidigit.workers.dev

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
