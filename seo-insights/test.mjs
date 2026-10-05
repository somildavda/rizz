import { readFileSync } from 'node:fs';
import { parseCsv } from './src/csv.js';
import { normalizeRows, analyze } from './src/analyze.js';
console.log(JSON.stringify(analyze(normalizeRows(parseCsv(readFileSync('sample.csv', 'utf8')))), null, 1));
