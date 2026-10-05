#!/usr/bin/env bash
# One-command deploy: ./deploy.sh
# Logs in to Cloudflare (browser) if needed, deploys, and sets a passcode saved in ~/seo-insights/.passcode
set -e
cd "$(dirname "$0")"
PASS_FILE="$HOME/seo-insights/.passcode"

[ -d node_modules ] || npm install
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
npx wrangler deploy

if [ ! -f "$PASS_FILE" ]; then
  mkdir -p "$(dirname "$PASS_FILE")"
  W=(amber birch cedar delta ember frost grove harbor iris jade kelp lunar maple nova onyx pine)
  echo "${W[RANDOM%16]}-${W[RANDOM%16]}-${W[RANDOM%16]}-$((RANDOM%90+10))" > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
fi
printf '%s' "$(cat "$PASS_FILE")" | npx wrangler secret put ACCESS_TOKEN

echo
echo "Passcode: $(cat "$PASS_FILE")   (saved in $PASS_FILE)"
echo "Optional, for written client summaries: npx wrangler secret put ANTHROPIC_API_KEY"
