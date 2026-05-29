// release-helper.mjs  — commit + tag for 0.8.5
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const files = [
  'CHANGELOG.md',
  'package.json',
  'packages/cli/package.json',
  'packages/core/package.json',
  'packages/tools/package.json',
  'packages/tui/package.json',
  'packages/webui/package.json',
  'packages/providers/package.json',
  'packages/runtime/package.json',
  'packages/mcp/package.json',
  'packages/skills/package.json',
  'packages/plug-lsp/package.json',
  'packages/telegram/package.json',
  'apps/wrongstack/package.json',
];

async function run(cmd) {
  console.log(`$ ${cmd}`);
  try {
    const { stdout, stderr } = await execAsync(cmd, { shell: true, encoding: 'utf8' });
    if (stdout?.trim()) console.log(stdout.trim());
    if (stderr?.trim()) process.stderr.write(stderr.trim() + '\n');
  } catch (e) {
    console.error('ERROR:', e.message);
    if (e.stderr?.trim()) process.stderr.write(e.stderr.trim() + '\n');
  }
}

for (const f of files) {
  await run(`git add "${f}"`);
}
await run('git status --short');
await run('git commit -m "release 0.8.5"');
await run('git tag v0.8.5');
console.log('\nDone.');
