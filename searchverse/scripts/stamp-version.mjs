// Writes public/version.json before each deploy so open tabs can offer a reload.
import { writeFileSync } from 'node:fs';
const v = new Date().toISOString();
writeFileSync(new URL('../public/version.json', import.meta.url), JSON.stringify({ v }) + '\n');
console.log('Searchverse version', v);
