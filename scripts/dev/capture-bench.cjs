const fs = require('node:fs');
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  fs.writeFileSync('compactor-bench-full.txt', d);
  console.error('Written', d.length, 'chars');
});
