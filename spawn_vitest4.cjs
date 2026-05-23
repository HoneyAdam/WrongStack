const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outFile = path.join(__dirname, 'test_out.txt');
const errFile = path.join(__dirname, 'test_err.txt');
const testFile = 'packages/core/tests/execution/parallel-eternal-engine.test.ts';
const vitestCmd = path.join(__dirname, 'node_modules/.bin/vitest');

// Windows: use cmd /c with backslash path
const child = spawn('cmd', ['/c', `node_modules\\.bin\\vitest run ${testFile}`], {
  cwd: __dirname,
  stdio: ['ignore', 'inherit', 'inherit'],
  timeout: 90_000,
});

const timer = setTimeout(() => { child.kill(); process.exit(4); }, 90_000);
child.on('close', (code) => { clearTimeout(timer); process.exit(code ?? 0); });