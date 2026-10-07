# Searchverse YouTube Audit

Audits your YouTube channel against up to 10 competitors and scores titles, descriptions, CTAs, hashtags, thumbnails, engagement, publishing cadence, length, themes, formats, funnel intent and content gaps. It is the web version of the "Search Indicators" Google Sheets Apps Script. The rules and the report tabs are the same, and it adds CTA and thumbnail checks.

Running cost: **₹0**. It uses the Cloudflare Workers free plan, the YouTube Data API free quota and the Gemini free tier, which is optional.

## How it works

```
Browser (public/)                          Cloudflare Worker (src/worker.js)
 ├─ form: your channel + competitors  ──▶  GET  /api/channel?q=…   → YouTube Data API (key stays on server, 6h cache)
 ├─ analysis.js: scoring + 12 reports      POST /api/ai/rewrite   → Gemini: 3 titles, CTA review/rewrite, hashtags
 └─ tabs, filters, CSV / JSON / PDF        POST /api/ai/thumbnail → Gemini vision: thumbnail score + fixes
```

- **Input:** channel URL, `@handle`, `/channel/UC…`, or any video link from the channel.
- **Quota:** about 1 unit per 50 videos. One channel with 200 videos costs about 10 of the 10,000 free daily units. Only legacy `/c/name` URLs fall back to search, which costs 100 units.
- **Report tabs:** Dashboard (KPIs and benchmark with ranks), Publishing Frequency, Video Length, Themes, Formats, Intent / Funnel, Thumbnails (gallery), Top Content, Underperforming, Content Gaps, SEO & CTA Audit, Recommendations, and AI Review.

### Changes from the Apps Script
- Competitor subscriber counts are real. The sheet showed `—`.
- Content-gap similarity uses title keyword overlap. The sheet used a random number.
- A new CTA audit records the CTA types (subscribe, link, lead, shop, follow), whether a CTA appears above the fold, the link count and a 0–100 CTA score.
- Chapter (timestamp) detection is added.
- Thumbnails get an HD custom-thumbnail check plus an optional AI visual review.
- Shorts are detected for videos of 60 seconds or less, and for videos up to 3 minutes tagged `#shorts`.
- Video-length recommendations are relative to the analysed average instead of fixed view counts.
- The OpenAI call (paid) is replaced by Gemini (free tier).

## Run locally

```bash
cd searchverse
npm install
echo 'YT_API_KEY=your-key' > .dev.vars    # optional second line: GEMINI_API_KEY=…
npm run dev                               # http://localhost:8787
npm test                                  # analysis unit tests
```

## Deploy to Cloudflare (free)

```bash
npx wrangler login
npx wrangler secret put YT_API_KEY        # Google Cloud → enable "YouTube Data API v3" → create API key
npx wrangler secret put GEMINI_API_KEY    # optional, from aistudio.google.com
npm run deploy                            # → https://searchverse-yt-audit.<you>.workers.dev
```

Restrict the YouTube key to the YouTube Data API in Google Cloud. Anyone with the Workers URL can spend its quota, so put the tool behind Cloudflare Access (free for up to 50 users) before sharing it.

## Roadmap
1. **YouTube audit** (this release).
2. **Connect channel (owner mode):** Google sign-in with the YouTube Analytics API for CTR, impressions and retention. This needs an OAuth client in Google Cloud.
3. **AI search / citation tracker:** which prompts people ask, and which YouTube videos ChatGPT, Gemini, Perplexity and AI Overviews cite. Before building it, compare open-source GitHub projects for accuracy.
4. Save audits over time in D1 and schedule weekly re-audits with Cron.
