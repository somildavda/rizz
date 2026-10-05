# SEO Insights (separate Cloudflare Worker)

Turns page-path SEO data into a plain-language client update plus data tables for the team.
It deploys as its **own** Worker (`seo-insights`) and is not connected to the Rizz site.

## Deploy to a new Cloudflare account
```
cd seo-insights
npm install
npx wrangler login                 # log in to the Cloudflare account you want to use
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_TOKEN          # optional password
npx wrangler secret put GSC_SERVICE_ACCOUNT   # optional, paste the service-account JSON
npx wrangler deploy
```

## Connecting data
- **Google Sheets (easiest):** File → Share → Publish to web → choose the tab → CSV, then paste the link.
- **Private Sheet / GSC:** create a Google Cloud service account, enable the Search Console and Sheets APIs,
  then add the service-account email as a user in GSC (Settings → Users) and share the sheet with it.
- **CSV:** paste it. Accepted columns: Page/Page path/URL, Clicks, Impressions, CTR, Position,
  and optionally Prev Clicks, Prev Impressions, Prev Position, Sessions, Conversions.

Local test: `node test.mjs` (uses `sample.csv`).
