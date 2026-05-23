const { spawn } = require('child_process');
const path = require('path');
const vitest = path.join(__dirname, 'node_modules', '.bin', 'vitest');
const testFile = path.join(__dirname, 'packages/core/tests/execution/parallel-eternal-engine.test.ts');
const child = spawn(process.execPath, [vitest, 'run', testFile], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
});
child.on('exit', (code) => process.exit(code ?? 0));