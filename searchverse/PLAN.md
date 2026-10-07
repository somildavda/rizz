# YouTube Audit & AI Citation Tracker: build plan

Goal: a free, dev-grade tool that audits several YouTube channels at once. It scores titles, descriptions, CTAs, thumbnails, engagement and upload cadence. It also suggests the prompts that are likely to cite those videos in AI answers, and checks whether they actually do.

**Constraint: ₹0 running cost.** Everything below runs on free tiers. Where nothing free exists, the plan says so and gives a workaround.

---

## 1. Free stack

| Layer | Choice | Free limit | Why |
|---|---|---|---|
| Hosting / API | **Cloudflare Workers** (TypeScript + [Hono](https://github.com/honojs/hono)) | 100k requests/day | New Cloudflare account, as planned. No server to run. |
| Frontend | **Cloudflare Pages** (static HTML/JS) | Unlimited static | Dashboard and report view |
| Database | **Cloudflare D1** (SQLite) | 5 GB, 5M reads/day | Channels, videos, scores, history |
| Cache | **Workers KV** | 100k reads/day | Caches API responses so quota isn't spent twice |
| Scheduled jobs | **Cron Triggers** | Included | Weekly re-audits and citation re-checks |
| YouTube data | **YouTube Data API v3** | 10,000 units/day | Official API. See the quota math below. |
| Text AI (CTA, title, prompts) | **Gemini API free tier** (Flash) as the main model, **Workers AI** (Llama) as backup | Free tier rate limits | No card needed |
| Thumbnail AI | **Workers AI vision model** (Llama 3.2 Vision) or Gemini Flash (it accepts images) | ~10k neurons/day | Judges readability, faces, contrast and text |
| AI citation check | **Gemini with Google Search grounding** (free tier) | Small daily cap | Returns the URLs it cites, so we can match `youtube.com/watch?v=` |
| Report export | HTML report + CSV, optionally pushed to Google Sheets with your existing **Apps Script** as a webhook | Free | Reuses what you already built |

> Python FastAPI (named in the form) is replaced by TypeScript on Workers, because Workers' Python support is still limited and FastAPI would need a paid host. Update the "Tools" field in the form to match (see section 8).

### YouTube quota math (why this stays free)
- `channels.list` = 1 unit. It returns the uploads playlist and subscriber and view totals.
- `playlistItems.list` = 1 unit per 50 videos.
- `videos.list` = 1 unit per 50 videos. It returns stats, tags, duration and thumbnails.
- **Do not use `search.list`.** It costs 100 units.

So **one channel with 200 videos costs about 10 units**. The 10k daily quota covers about **500–1,000 channel audits a day**, which is far more than we need.

---

## 2. What the tool does (modules)

### M1. Channel ingest
Input: channel URLs, @handles or IDs (your client plus 3–5 competitors).
→ resolve each to a channel ID → read the uploads playlist → fetch the last N videos (default 50) → store them in D1.

### M2. Rule-based audit (no AI, instant, free)
| Check | Rule (starting point, tunable) |
|---|---|
| Title length | 40–70 chars; keyword in the first 40 |
| Title hooks | number, question, year, brackets, power words |
| Description | ≥ 200 words; first 150 chars carry the keyword; has timestamps/chapters |
| CTA presence | regex for subscribe / link / comment / download / visit / shop, plus links in the first 3 lines |
| Links | count, UTM present, linked shorts and playlists |
| Hashtags | 1–3 present (> 15 = YouTube ignores them all) |
| Tags | present; count; overlap with the title |
| Thumbnail | maxres exists (custom thumbnail uploaded vs. auto-generated) |
| Engagement | (likes + comments) / views, compared with the channel median |
| Cadence | uploads/week, gaps, consistency score |
| Shorts vs. long-form | duration split and performance by type |
| Outliers | videos with ≥ 2× the channel median views (what is working) |

Each video gets a **0–100 score**, and each channel gets averages per pillar.

### M3. AI audit (free tier, run only on a top/bottom sample to save limits)
- **CTA quality**: is the CTA clear, specific and placed early? Suggests a rewrite.
- **Title rewrite**: 3 alternatives per weak title.
- **Thumbnail review** (vision): text readable on mobile? face or emotion present? contrast? clutter? consistent with the brand? Output: score + 2 fixes.
- **Competitor gap summary**: topics competitors cover that the client doesn't.

### M4. AI citation module
1. **Prompt generation**: from each video's title, description and transcript topics, generate 5–10 natural questions a user would ask an AI ("best budget phone under 15000", "how to style oversized shirts men").
2. **Citation check (free)**: run each prompt through Gemini with Google Search grounding → collect the cited URLs → flag any YouTube URLs and match them to tracked channels.
3. **Output**: a prompt × channel matrix showing who gets cited, citation share per channel, and "opportunity" prompts where a competitor is cited and the client isn't.

**Where we can't be free, and how we handle it:**
| Engine | Free automated? | Plan |
|---|---|---|
| Gemini (grounded) | ✅ free tier | Automated |
| Google AI Overviews | ❌ no official API (SerpAPI is about 100 free searches/month) | Use SerpAPI's free credits for the top 20–50 prompts only, or **manual paste mode** |
| ChatGPT / Perplexity | ❌ paid APIs | **Manual paste mode**: the tool gives the analyst the prompt list; the analyst pastes the answers back; the tool extracts YouTube links automatically |

Manual paste mode keeps the cost at ₹0 and still records the data the same way every time.

### M5. Report
- Dashboard: channel comparison cards, pillar scores, outliers, cadence chart.
- Per-video table with flags and fixes.
- Citation matrix.
- Export: CSV, printable HTML/PDF, and optionally a push to Google Sheets through the existing Apps Script.

---

## 3. Architecture

```
[Pages UI] ──fetch──▶ [Worker API (Hono)]
                         ├─ /api/audit        → M1 + M2 (sync), queues M3
                         ├─ /api/ai-audit     → M3 (Gemini / Workers AI)
                         ├─ /api/prompts      → M4 prompt generation
                         ├─ /api/citations    → M4 grounded check / manual paste
                         └─ /api/report/:id   → M5
                         │
                         ├─ D1: channels, videos, scores, prompts, citations, audits
                         ├─ KV: API response cache (24h)
                         └─ Cron: weekly re-audit + citation re-check
Secrets (wrangler secret): YT_API_KEY, GEMINI_API_KEY, (optional) SERPAPI_KEY
```

### D1 schema (first draft)
```sql
audits(id, created_at, name, status)
channels(id, audit_id, yt_channel_id, title, subs, views, video_count, is_client)
videos(id, channel_id, yt_video_id, title, description, published_at, duration_s,
       views, likes, comments, tags_json, thumb_url, is_short)
video_scores(video_id, title_s, desc_s, cta_s, thumb_s, engage_s, total, flags_json, ai_json)
prompts(id, audit_id, text, source_video_id)
citations(id, prompt_id, engine, cited_url, yt_video_id, channel_id, checked_at, mode) -- mode: auto|manual
```

---

## 4. Open-source to reuse (check licences before copying)
- **honojs/hono**: Worker routing.
- **googleapis YouTube Data API samples**: request shapes.
- **youtube-transcript (JS) / youtube-transcript-api (Py)**: transcripts for prompt generation. These are unofficial and can break, so treat them as optional and fall back to title + description.
- **Existing Apps Script**: port its checks into M2 so the scoring logic you already validated carries over.
- Search GitHub for "youtube channel audit" / "youtube seo analyzer" while building M2 for extra rule ideas. Reuse the rules, not whole apps.

---

## 5. Build phases

| Phase | Output | Est. |
|---|---|---|
| 0. Setup | New Cloudflare account, `wrangler` project, D1 + KV, Google Cloud project with the YouTube API key, Gemini key | 0.5 day |
| 1. Ingest + rule audit (M1, M2) | Paste channels → scored table | 2 days |
| 2. Dashboard + CSV (M5 basic) | Usable internal tool, **first time-saving test** | 1–2 days |
| 3. AI audit (M3) | CTA, title and thumbnail suggestions | 1–2 days |
| 4. Citations (M4) | Prompt generation + Gemini check + manual paste mode | 2 days |
| 5. Validate | Run on 1 client + 3 competitors; analyst spot-checks accuracy against the manual baseline | 1–2 days |

Phases 1–2 alone already prove the main hypothesis (time saved and a consistent checklist).

---

## 6. Risks
- **Free AI limits**: AI runs only on sampled videos; results are cached in D1; Gemini and Workers AI back each other up.
- **Owner metrics (CTR, retention)** need YouTube Analytics OAuth from the channel owner. That is phase 2+ "owner mode", still free.
- **Citation results vary** from run to run and region to region: store every check with a timestamp and report trends, not single snapshots.
- **Transcript scraping is unofficial**: keep it optional.

---

## 7. Metrics to log automatically (feeds the form)
Audit start/end time, channels and videos per audit, checks completed / total, API units used, AI calls used (→ cost per audit = ₹0), citations found per channel.

---

## 8. Updated form field: "Tools You Are Using"
> YouTube Data API v3, Cloudflare Workers + Pages + D1 (free tier), TypeScript (Hono), Gemini API free tier with Google Search grounding (AI analysis, prompt generation, citation checks), Cloudflare Workers AI (thumbnail vision analysis), existing Google Apps Script (Sheets export), open-source GitHub libraries, Claude for development. Target cost: ₹0 (free tiers only); ChatGPT/Perplexity/AI Overview citations logged via manual paste mode.

And under "Support You Need", drop the budget line and replace it with:
> A Google Cloud project for the YouTube Data API key and a Gemini API key (both free), a new Cloudflare account (free), access to 1–2 client channels for owner mode, and analyst time to validate the output.
