// Debug CJK table rendering
import { renderMarkdownTables } from './src/markdown-table.js';

const input = [
  '| Name | Status |',
  '|------|--------|',
  '| 名前 | ✅    |',
  '| 山本 | ❌    |',
].join('\n');

const out = renderMarkdownTables(input, 60);
const lines = out.split('\n');

console.log('Input:');
console.log(input);
console.log('\nOutput:');
lines.forEach((l, i) => console.log(`Line ${i}: "${l}" (len=${l.length})`));

console.log('\nWidths:', [...new Set(lines.map(l => l.length))]);
