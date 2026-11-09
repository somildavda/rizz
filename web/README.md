# searchverse.in

The SearchVerse website and SEO suite: Next.js on Cloudflare (free plan), with its
own sign-in, Access Center, emails and databases.

| Address | What |
|---|---|
| `/` | Public homepage |
| `/login` | Sign in or request access |
| `/dashboard` | Overview of the chosen project |
| `/dashboard/audit` | Site Audit: crawls the site, lists SEO issues, health score |
| `/dashboard/speed` | Site Speed: PageSpeed Insights, Core Web Vitals, fixes |
| `/dashboard/rankings` | Rankings: Search Console upload, quick wins, what moved |
| `/topic-planner/` | Topic Planner: content gaps, topical map, briefs |
| `/access` | Access Center (team admins and owner) |
| `/privacy`, `/terms` | Legal pages |

## Code
```
app/            Next.js pages (React)
components/     dashboard shell, tables, gauges, site nav
lib/api.js      browser helpers
server/         runs on Cloudflare: auth.js (sign-in + Access Center API), email.js,
                app-store.js (accounts DB), db.js (projects DB), content-gap.js (crawler), psi.js
worker.js       entry: security headers, sign-in check, APIs, then Next.js
public/         Topic Planner app and the shared theme
```
Edit a page: change its file in `app/`, push to `main`, and it deploys.

Run it locally: `npm install`, then `npm run preview` (builds and serves on Cloudflare's local runtime).

## Go live (one time)
1. **Cloudflare account**: turn on two-factor sign-in (My Profile → Authentication).
2. **Domain**: buy `searchverse.in` (GoDaddy, Hostinger, BigRock or Namecheap) and turn on two-factor there too.
3. **Connect it**: Cloudflare → Add a domain → `searchverse.in` → Free plan. Copy the two nameservers into your registrar. Wait until Cloudflare says **Active**.
4. **Protections** (Cloudflare → searchverse.in): SSL/TLS = Full (strict); Always Use HTTPS = on; Security → Bots → Bot Fight Mode = on.
5. **Deploy from GitHub**: create an API token (My Profile → API Tokens → "Edit Cloudflare Workers" template) and add GitHub repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Every push to `main` touching `web/` deploys (`.github/workflows/web-deploy.yml`).
6. **Use the domain**: in `wrangler.jsonc` uncomment `routes` and `CANONICAL_HOST`, set `workers_dev` to `false`, push.
7. **First sign-up**: open `https://searchverse.in/login` → Request access. The first account becomes the owner.

## Emails from SearchVerse (Resend, free: 3,000/month)
Sent when someone requests access (to them and to admins), is approved, rejected, or has their role changed, and a welcome email for the owner.
1. Sign up at resend.com → Domains → add `searchverse.in` → it shows DNS records.
2. Add those records in Cloudflare → searchverse.in → DNS (Resend can also add them for you with its Cloudflare button).
3. Resend → API Keys → create one, then in `web/`: `npx wrangler secret put RESEND_API_KEY` and paste it. Never commit it.
Emails come from `hello@searchverse.in` (change `MAIL_FROM` in `wrangler.jsonc`).

**Receiving mail** at `hello@searchverse.in`: Cloudflare → searchverse.in → Email → Email Routing → forward to your Gmail (free).

## Optional
- Higher PageSpeed quota: create a Google API key for PageSpeed Insights and `npx wrangler secret put PSI_KEY`.
- Rate-limit sign-in: Cloudflare → Security → WAF → Rate limiting rule for path `/api/auth/login`, 10 requests per minute per IP, action Block.
- Move projects from the old Topic Planner: as owner, download `/api/cg/db/export` there, then Access Center → Restore / import here.
