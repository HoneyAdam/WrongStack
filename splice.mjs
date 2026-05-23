import { readFileSync, writeFileSync } from 'node:fs';
const c = readFileSync('packages/cli/src/execution.ts', 'utf8');
const modified = c.replace(/\n    getAutonomy,/g, '\n    getAutonomy,\n    onAutonomy,');
writeFileSync('packages/cli/src/execution.ts', modified, 'utf8');
console.log(modified.includes('onAutonomy,') ? 'OK' : 'FAILED');
