import * as fs from 'node:fs';
const f = fs.readFileSync('packages/cli/tests/pre-launch.test.ts', 'utf8');
const lines = f.split('\n');
// Find persistLaunchChoices tests
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('persistLaunchChoices')) {
    const start = Math.max(0, i - 2);
    const end = Math.min(lines.length, i + 40);
    console.log(lines.slice(start, end).map((l, idx) => (idx + start + 1) + '|' + l).join('\n'));
    console.log('\n---\n');
  }
}
