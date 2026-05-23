import { readFileSync, writeFileSync } from 'node:fs';
const file = 'D:/Codebox/PROJECTS/WrongStack/packages/cli/src/execution.ts';
const c = readFileSync(file, 'utf8');
// Fix the second runRepl call: add onAutonomy after getAutonomy in the second runRepl invocation
const modified = c.replace(
  /(\n          getAutonomy,\n)(          getEternalEngine,\n)/,
  '$1          onAutonomy,\n$2'
);
writeFileSync(file, modified, 'utf8');
console.log(c === modified ? 'UNMODIFIED' : 'MODIFIED');
