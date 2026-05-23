import { readFileSync, writeFileSync } from 'node:fs';
const file = 'D:/Codebox/PROJECTS/WrongStack/packages/cli/src/execution.ts';
const c = readFileSync(file, 'utf8');
// The second runRepl has 8-space indentation; fix it by adding onAutonomy after getAutonomy
const modified = c.replace(
  /(\n        getAutonomy,\n)(        getEternalEngine,)/g,
  '$1        onAutonomy,\n$2'
);
writeFileSync(file, modified, 'utf8');
const count = (modified.match(/onAutonomy,/g) || []).length;
console.log(`onAutonomy count: ${count} (expect 4)`);
