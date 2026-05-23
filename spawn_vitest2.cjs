const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outFile = path.join(__dirname, 'test_out.txt');
const errFile = path.join(__dirname, 'test_err.txt');
const testFile = path.join(__dirname, 'packages/core/tests/execution/parallel-eternal-engine.test.ts');
const vitestMain = path.join(__dirname, 'node_modules', 'vitest', 'dist', 'cli.js');

const child = spawn(process.execPath, [vitestMain, 'run', testFile], {
  cwd: __dirname,
  shell: false,
});

const outFd = fs.openSync(outFile, 'w');
const errFd = fs.openSync(errFile, 'w');
child.stdout.fd = outFd;
child.stderr.fd = errFd;

child.on('close', (code) => {
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  console.log('exit code:', code);
});