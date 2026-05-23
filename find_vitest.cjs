const fs = require('fs');
const path = require('path');
const vitestPath = path.join(__dirname, 'node_modules', '.bin', 'vitest');
const exists = fs.existsSync(vitestPath);
console.log(exists ? vitestPath : 'vitest not found');