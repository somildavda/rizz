// Writes public/version.json before each deploy so open tabs can tell
// that a new version is live and offer a Reload button.
import { writeFileSync } from 'node:fs';
const version = new Date().toISOString();
writeFileSync(new URL('../public/version.json', import.meta.url), JSON.stringify({ version }) + '\n');
console.log('Version', version);
