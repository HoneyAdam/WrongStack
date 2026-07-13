const fs = require('node:fs');
const file = process.argv[2];
const start = parseInt(process.argv[3], 10);
const end = parseInt(process.argv[4], 10);
const lines = fs.readFileSync(file, 'utf8').split('\n');
for (let i = start - 1; i < Math.min(end, lines.length); i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}
