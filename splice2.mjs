import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'packages/cli/src/execution.ts',
];
for (const file of files) {
  const c = readFileSync(file, 'utf8');
  // Add onAutonomy= after getAutonomy= in runRepl calls (both branches)
  const modified = c.replace(/(getAutonomy,\n)(          getEternalEngine,)/g, '$1          onAutonomy,$2');
  const ok = modified.includes('onAutonomy,');
  writeFileSync(file, modified, 'utf8');
  console.log(`${file}: ${ok ? 'OK' : 'WARN - check manually'}`);
}
