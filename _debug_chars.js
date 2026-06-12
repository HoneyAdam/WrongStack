const fs = require('fs');
const c = fs.readFileSync('packages/core/src/sdd/task-visualizer.ts', 'utf8');
const lines = c.split('\n');
for (let i = 228; i < 236; i++) {
  console.log(i + 1, JSON.stringify(lines[i]));
}
