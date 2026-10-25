#!/usr/bin/env bash
# One-step deploy of Journey to Cloudflare Workers (uses your logged-in wrangler).
# Run from this folder: bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "1/4 Building the app bundle…"
python3 build-worker.py

if [ ! -f .vapid.json ]; then
  echo "2/4 Creating keys for daily reminders (once)…"
  node -e '
    const c = require("crypto"); const { privateKey } = c.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = privateKey.export({ format: "jwk" });
    const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
    require("fs").writeFileSync(".vapid.json", JSON.stringify({ publicKey: pub, privateJwk: jwk }));'
  node -e 'process.stdout.write(JSON.stringify(require("./.vapid.json").privateJwk))' | npx -y wrangler secret put VAPID_PRIVATE_JWK
else
  echo "2/4 Reminder keys already set."
fi
PUB=$(node -e 'process.stdout.write(require("./.vapid.json").publicKey)')

echo "3/4 Deploying…"
npx -y wrangler deploy --var "VAPID_PUBLIC:$PUB"

if [ ! -f .sync-key-set ]; then
  echo "4/4 Choose a kitchen sync password (you'll type the same one in the app's Settings):"
  npx -y wrangler secret put EDIT_KEY && touch .sync-key-set
else
  echo "4/4 Sync password already set."
fi

echo
echo "Done: https://journey.somildavda.workers.dev  ·  Kitchen: https://journey.somildavda.workers.dev/kitchen"
