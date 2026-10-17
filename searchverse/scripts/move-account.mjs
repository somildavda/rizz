// Sets Searchverse up on the Cloudflare account you are logged in to (npx wrangler login) and deploys it.
// Usage: npm run move-account            (or: npm run move-account -- <ACCOUNT_ID> if you have several accounts)
// It: pins the account in wrangler.toml, creates the main database (if needed), drops storage databases
// that belong to another account, creates all tables, deploys, and asks for the secrets it needs.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const sh = process.platform === 'win32';
const run = (args, input) => {
  const r = spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8', input, shell: sh, env: { ...process.env, ...(ACCOUNT ? { CLOUDFLARE_ACCOUNT_ID: ACCOUNT } : {}) } });
  return (r.stdout || '') + (r.stderr || '');
};
const live = (args) => spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit', shell: sh, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } }).status === 0;
const stop = (msg) => { console.error('\n❌ ' + msg + '\n'); process.exit(1); };
let ACCOUNT = null;

// 1. who is logged in
console.log('\n🔐 Checking your Cloudflare login…');
const who = run(['whoami']);
const email = who.match(/associated with the email\s+(\S+?)\.?\s*$/m)?.[1] || '';
const ids = [...who.matchAll(/\b([0-9a-f]{32})\b/g)].map((m) => m[1]);
if (!ids.length) stop('Not logged in. Run:  npx wrangler login   then run this again.');
ACCOUNT = process.argv[2] || ids[0];
if (!ids.includes(ACCOUNT)) stop(`Your login (${email}) has no access to account ${ACCOUNT}. Accounts you can use: ${ids.join(', ')}`);
if (ids.length > 1 && !process.argv[2]) stop(`You have several accounts: ${ids.join(', ')}\n   Run again with the one to use, e.g.:  npm run move-account -- ${ids[0]}`);
console.log(`   ✔ ${email || 'logged in'} · account ${ACCOUNT}`);

// 2. databases on this account
const listOut = run(['d1', 'list', '--json']);
let dbs = [];
try { dbs = JSON.parse(listOut.slice(listOut.indexOf('['))); } catch { stop('Could not list your databases. Wrangler said:\n' + listOut); }
let main = dbs.find((d) => d.name === 'searchverse');
if (!main) {
  console.log('➕ Creating the main database "searchverse" (free, 500 MB)…');
  const out = run(['d1', 'create', 'searchverse']);
  const id = out.match(/database_id\W+([0-9a-f-]{36})/i)?.[1];
  if (!id) stop('Could not create the database. Wrangler said:\n' + out);
  main = { name: 'searchverse', uuid: id };
} else console.log('   ✔ Main database already exists on this account');
const mine = new Set([...dbs.map((d) => d.uuid), main.uuid]);

// 3. rewrite wrangler.toml for this account
let toml = readFileSync('wrangler.toml', 'utf8');
toml = toml.replace(/^account_id\s*=.*\n/m, '');
toml = `account_id = "${ACCOUNT}"\n` + toml;
toml = toml.replace(/(binding = "DB"\s*\ndatabase_name = "[^"]*"\s*\ndatabase_id = ")[^"]*(")/, `$1${main.uuid}$2`);
const dropped = [];
toml = toml.replace(/\n*\[\[d1_databases\]\]\s*\nbinding = "(DATA\d+)"\s*\ndatabase_name = "([^"]*)"\s*\ndatabase_id = "([^"]*)"\s*\n?/g, (block, b, name, id) => {
  if (mine.has(id)) return block;
  dropped.push(b);
  return '\n';
});
if (email && /ADMIN_EMAILS = ""/.test(toml)) toml = toml.replace('ADMIN_EMAILS = ""', `ADMIN_EMAILS = "${email}"`);
writeFileSync('wrangler.toml', toml.replace(/\n{3,}/g, '\n\n'));
console.log(`   ✔ wrangler.toml now points at this account${dropped.length ? ` (removed ${dropped.join(', ')} — they belong to another account)` : ''}`);

// 4. tables
console.log('📋 Creating tables…');
let out = run(['d1', 'execute', 'searchverse', '--remote', '--file=schema.sql'], 'y\n');
if (!/success|executed|already exists/i.test(out)) stop('Creating tables failed. Wrangler said:\n' + out);
for (const [, b, name] of toml.matchAll(/binding = "(DATA\d+)"\s*\ndatabase_name = "([^"]*)"/g)) {
  out = run(['d1', 'execute', name, '--remote', '--file=data-schema.sql'], 'y\n');
  console.log(`   ${/success|executed|already exists/i.test(out) ? '✔' : '⚠'} ${b} (${name})`);
}

// 5. deploy (asks for a workers.dev name the first time)
console.log('\n🚀 Deploying… (if asked to register a workers.dev subdomain: type y, then a short name like  infidigit)\n');
spawnSync('node', ['scripts/stamp-version.mjs'], { stdio: 'inherit' });
if (!live(['deploy'])) stop('Deploy failed — see the message above.');

// 6. secrets
const have = run(['secret', 'list']);
const need = (k) => !have.includes(`"${k}"`);
if (need('APP_SECRET')) {
  console.log('\n🔑 Setting APP_SECRET (generated for you)…');
  run(['secret', 'put', 'APP_SECRET'], randomBytes(32).toString('hex') + '\n');
}
for (const [k, hint] of [['GOOGLE_CLIENT_ID', 'your Google OAuth Client ID (ends in .apps.googleusercontent.com)'], ['GOOGLE_CLIENT_SECRET', 'your Google OAuth Client secret'], ['GEMINI_API_KEY', 'your free Gemini key (optional — press Enter to skip)']]) {
  if (!need(k)) { console.log(`   ✔ ${k} already set`); continue; }
  console.log(`\n🔑 Paste ${hint}, then press Enter:`);
  live(['secret', 'put', k]);
}

console.log(`\n🎉 Searchverse is live on account ${ACCOUNT}.
Last step in Google Cloud → APIs & Services → Credentials → your OAuth client:
  • Authorised JavaScript origins:  https://searchverse.<your-subdomain>.workers.dev
  • Authorised redirect URIs:       https://searchverse.<your-subdomain>.workers.dev/auth/callback
(use the link printed by the deploy above). Then open the link and sign in with ${email || 'your admin email'}.\n`);
