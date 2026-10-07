// Adds one more free 500 MB Cloudflare D1 database to Searchverse YouTube (up to 9 extra = 5 GB total).
// Usage: npm run add-storage      (then: npm run deploy)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const toml = readFileSync('wrangler.toml', 'utf8');
if (toml.includes('REPLACE_WITH_YOUR_D1_DATABASE_ID')) {
  console.error('Set up the main database first (see GO-LIVE-GUIDE.md), then run this again.');
  process.exit(1);
}
let n = 1;
while (toml.includes(`binding = "DATA${n}"`)) n++;
if (n > 9) {
  console.log('You already have the free maximum (main + 9 extra databases = 5 GB).');
  process.exit(0);
}
const name = `searchverse-youtube-data-${n}`;
const run = (args, input) => {
  const r = spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8', input, shell: process.platform === 'win32' });
  return (r.stdout || '') + (r.stderr || '');
};

console.log(`\n➕ Creating free database ${name} (500 MB)…`);
let out = run(['d1', 'create', name]);
let id = out.match(/database_id\W+([0-9a-f-]{36})/i)?.[1];
if (!id && /already exists/i.test(out)) {
  const list = run(['d1', 'list', '--json']);
  try { id = JSON.parse(list.slice(list.indexOf('['))).find((d) => d.name === name)?.uuid; } catch {}
}
if (!id) {
  console.error('Could not create the database. Wrangler said:\n' + out);
  process.exit(1);
}

writeFileSync('wrangler.toml', toml.trimEnd() + `\n\n[[d1_databases]]\nbinding = "DATA${n}"\ndatabase_name = "${name}"\ndatabase_id = "${id}"\n`);
console.log(`✅ Added DATA${n} to wrangler.toml`);

console.log('📋 Creating tables…');
out = run(['d1', 'execute', name, '--remote', '--yes', '--file=data-schema.sql']);
if (!/success|executed/i.test(out)) {
  console.error('Creating tables may have failed. Wrangler said:\n' + out);
  process.exit(1);
}
console.log(`\n🎉 Done — storage is now ${(n + 1) * 500} MB (${n + 1} × 500 MB, free).`);
console.log('   Now run:  npm run deploy\n');
