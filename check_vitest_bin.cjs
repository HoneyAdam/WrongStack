const path = require('path');
const fs = require('fs');

const vitestBin = path.join(__dirname, 'node_modules', '.bin', 'vitest');
const content = fs.readFileSync(vitestBin, 'utf8');
console.log(vitestBin);
console.log(content.slice(0, 200));