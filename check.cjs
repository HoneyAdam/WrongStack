const fs = require('fs');
const path = 'packages/cli/src/execution.ts';
let c = fs.readFileSync(path, 'utf8');
const cnt = (c.match(/onAutonomy,/g) || []).length;
console.log('current onAutonomy count:', cnt);
fs.writeFileSync(path, c, 'utf8');
