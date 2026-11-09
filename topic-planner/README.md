# Topic Planner (standalone Worker)

The content gap tool, as its own Cloudflare Worker with its own sign-in, Access
Center, dashboard and database. It's separate from the SearchVerse hub, which now
links here.

```
src/index.js        routes: sign-in gate, /api/cg/db/* (projects), /api/cg/* (crawler APIs), static files
src/auth.js         /login, /api/auth/*, /access + /api/access/* (team admins and owner)
src/pages.js        HTML for the sign-in page and the Access Center
src/app-store.js    accounts and sessions (SQLite Durable Object "APP")
src/db.js           projects, scans, topics (SQLite Durable Object "PROJECTS"), + overview, backup/restore
src/content-gap.js  subdomains, robots, sitemaps, page fetch, suggest, SERP, Gemini
public/             the app: dashboard (#/), project setup, scan, results
```

**Access.** The first account created becomes the owner. Everyone else uses "Request
access" on the sign-in page and waits in the Access Center (`/access`) until a team
admin or the owner approves them. Roles: owner › team admin › project manager ›
member › viewer.

## Deploy (new Cloudflare Worker)
Option A, Cloudflare dashboard: Workers & Pages → Create → Import a repository →
`somildavda/rizz`, root directory `topic-planner`, deploy command `npx wrangler deploy`.

Option B, GitHub Actions: `.github/workflows/topic-planner-deploy.yml` deploys on pushes
to `main` that touch `topic-planner/` (uses the same `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` secrets as the hub).

Manual: `cd topic-planner && npx wrangler login && npx wrangler deploy`.

The hub links to `https://searchverse-topic-planner.shred-app.workers.dev/`. If your
address is different, change the `url` of the `content-gap` tool in
`searchverse/public/index.html`.

## Move your projects from the hub
1. Signed in to the hub as the owner, open `/api/cg/db/export` on the hub and save the JSON file.
2. In Topic Planner, sign up first (you become the owner), then on the dashboard choose
   **Restore / import** and pick that file. Projects that already exist are skipped.
