# SEO Insights

A free SEO analysis tool. It runs on Cloudflare Workers + D1 (free tier). You sign in with Google, connect the Google account(s) that have **Search Console** and **GA4** access, crawl the top pages, and get:

- **Scores**: Overall, On-page, Content (query coverage), Technical. Each is 0–100 and pages are weighted by impressions.
- **Per-page audit**: title/meta length, H1/H2, canonical, noindex, viewport, lang, alt text, schema, internal links, word count, response time, redirects.
- **Query coverage per page**: takes the queries the page actually ranks for in GSC and checks whether each appears in the title, H1, H2s, meta description, intro, URL and body. It also shows how many times it appears, density and a coverage score.
- **Opportunities**: striking-distance keywords (pos 4–15), low CTR for position, content gaps, keyword cannibalisation, declining/rising pages and queries, low-engagement organic landing pages (GA4).
- **AI recommendations (Gemini free tier)**: executive summary, priorities, quick wins, rewritten titles/metas/H1s, content ideas, technical fixes.
- **History**: every run is stored, so you can open any past run and see score/traffic trends.
- **Multiple projects + team sharing**: everyone signs in with their own Google account.

## Signing in with one account, data on another

You sign in with one account (e.g. your company email). Under **Settings → Connect a Google account** you connect each Google account that holds GSC/GA access, such as a client or personal account. The connection is read-only and the tokens are stored encrypted. Each project picks which connected account it reads from. You can connect as many accounts as you need.

## One-time setup (all free)

### 1. Google Cloud OAuth client
1. Go to https://console.cloud.google.com and create a project (e.g. `seo-insights`).
2. **APIs & Services → Library**: enable **Google Search Console API**, **Google Analytics Data API** and **Google Analytics Admin API**.
3. **OAuth consent screen**: pick **External**, fill in the app name and your email, and add the scopes `.../auth/webmasters.readonly` and `.../auth/analytics.readonly`.
   Leave it in **Testing** and add every Google account that will connect data (yours plus the GSC/GA account emails) under **Test users**.
   In Testing mode Google expires the data connection 7 days after each connect. The tool shows "expires in N days" for each account in Settings. When access runs out, it puts a **Reconnect** banner on the dashboard, and Reconnect takes about 10 seconds. Projects and history are never lost. (Sign-in itself is not affected.)
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorised redirect URI: `https://<your-worker>.workers.dev/auth/callback` (add `http://localhost:8787/auth/callback` for local dev).
   Copy the Client ID and Client secret.

### 2. Gemini key
Create a free key at https://aistudio.google.com/apikey. Either set it as a server secret (below), or have each user paste their own key in Settings.

### 3. Deploy to Cloudflare
```bash
cd seo-insights
npm install
npx wrangler login
npx wrangler d1 create seo-insights        # copy database_id into wrangler.toml
npm run db:init                            # creates tables
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put APP_SECRET         # any long random string (encrypts tokens)
npx wrangler secret put GEMINI_API_KEY     # optional
npm run deploy
```
Put the printed `https://seo-insights.<you>.workers.dev/auth/callback` into the OAuth client's redirect URIs.

To restrict who can sign in, set `ALLOWED_EMAILS` in `wrangler.toml` (e.g. `"@infidigit.com, me@gmail.com"`). People you add as project members can always sign in.

### Local development
Create `.dev.vars` with `GOOGLE_CLIENT_ID=…`, `GOOGLE_CLIENT_SECRET=…`, `APP_SECRET=…` (and optionally `GEMINI_API_KEY=…`). Then run:
```bash
npm run db:init:local && npm run dev   # http://localhost:8787
```

## How it works
- `src/worker.js`: Google OAuth, sessions, connections, projects, runs, GSC + GA4 pulls, a page fetcher limited to the project's own domain, the Gemini call, and D1 storage.
- `public/analyzer.js`: the scoring engine. It runs in the browser, which keeps the Worker within free-plan CPU limits.
- `public/app.js`: the UI.
- `schema.sql`: the D1 tables.

Free-tier notes: a run uses roughly 15 + N (pages) Worker requests and about 1 Gemini call. Cloudflare's free plan allows 100k requests a day and D1 gives 5 GB. Gemini's free tier rate limits apply; if a call fails, use **Regenerate** on the Insights tab.
