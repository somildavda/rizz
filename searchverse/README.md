# SearchVerse hub

Static site served by Cloudflare Workers (static assets). No build step.

- `public/index.html` — homepage
- `public/tools/<id>/index.html` — dedicated page per module
- `public/assets/tools.js` — module list (name, URL, features, steps)

## Add a module
1. Add an entry to `public/assets/tools.js`.
2. Copy `public/tools/speed/` to `public/tools/<new-id>/` and change `data-tool` and `data-exclude` to the new id.

## Deploy
```
cd searchverse
npx wrangler login
npx wrangler deploy
```
Or set repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; pushes to `main` touching `searchverse/` deploy automatically.
