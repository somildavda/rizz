#!/usr/bin/env bash
# One-step deploy of Journey to Cloudflare Workers (uses your logged-in wrangler).
# Run from this folder: bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "1/4 Building the app bundle…"
python3 build-worker.py

if grep -q PASTE_KV_NAMESPACE_ID wrangler.jsonc; then
  echo "2/4 Creating storage for meal swaps (KV)…"
  ID=$(npx -y wrangler kv namespace create MENU 2>&1 | grep -oE '[a-f0-9]{32}' | head -1)
  if [ -z "$ID" ]; then echo "Couldn't create the KV namespace. Run: npx wrangler login"; exit 1; fi
  sed -i.bak "s/PASTE_KV_NAMESPACE_ID/$ID/" wrangler.jsonc && rm -f wrangler.jsonc.bak
else
  echo "2/4 Storage already set up."
fi

echo "3/4 Deploying…"
npx -y wrangler deploy

if [ ! -f .sync-key-set ]; then
  echo "4/4 Choose a kitchen sync password (you'll type the same one in the app's Settings):"
  npx -y wrangler secret put EDIT_KEY && touch .sync-key-set
else
  echo "4/4 Sync password already set."
fi

echo
echo "Done. Your app is at the workers.dev address printed above."
echo "  Journey (you):  https://journey.<your-subdomain>.workers.dev/"
echo "  Kitchen (mom):  https://journey.<your-subdomain>.workers.dev/kitchen"
