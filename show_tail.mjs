import { readFileSync } from 'node:fs';
const d = readFileSync(process.argv[2], 'utf8');
const lines = d.split('\n');
console.log(lines.slice(325).join('\n'));
