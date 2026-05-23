const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outFile = path.join(__dirname, 'test_out.txt');
const errFile = path.join(__dirname, 'test_err.txt');
const testFile = 'packages/core/tests/execution/parallel-eternal-engine.test.ts';
const vitestBin = path.join(__dirname, 'node_modules/.bin/vitest');

const child = spawn('cmd', ['/c', `node_modules\\.bin\\vitest run ${testFile}`], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const outFd = fs.openSync(outFile, 'w');
const errFd = fs.openSync(errFile, 'w');
child.stdout.pipe(fs.createWriteStream(outFd, { fd: outFd }));
child.stderr.pipe(fs.createWriteStream(errFd, { fd: errFd }));

const timer = setTimeout(() => {
  child.kill();
  process.exit(4);
}, 90_000);

child.on('close', (code) => {
  clearTimeout(timer);
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  console.log('exit code:', code);
  process.exit(code ?? 0);
});