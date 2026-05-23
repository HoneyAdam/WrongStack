import { readFileSync, writeFileSync } from 'node:fs';

const file = 'packages/cli/src/execution.ts';
const lines = readFileSync(file, 'utf8').split('\n');
const out: string[] = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]!;
  // Restore proper indentation on the mangled line
  if (l.trim() === 'onAutonomy,          getEternalEngine,') {
    out.push('          onAutonomy,');
    out.push('          getEternalEngine,');
  } else if (i === 366) {
    // This is the mangled line itself — skip it since we handled above
  } else {
    out.push(l);
    // Fix second runRepl call: getAutonomy, getEternalEngine, getParallelEngine sequence
    if (l.trim() === 'getAutonomy,' && lines[i + 1]?.trim() === 'getEternalEngine,') {
      out.push('          onAutonomy,');
    }
  }
}
writeFileSync(file, out.join('\n'), 'utf8');
console.log('done');
