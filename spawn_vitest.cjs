const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outFile = path.join(__dirname, 'test_out.txt');
const errFile = path.join(__dirname, 'test_err.txt');
const vitestBin = path.join(__dirname, 'node_modules', '.bin', 'vitest');
const testFile = path.join(__dirname, 'packages/core/tests/execution/parallel-eternal-engine.test.ts');

const child = spawn(process.execPath, [vitestBin, 'run', testFile], {
  cwd: __dirname,
  shell: true,
});

const out = fs.openSync(outFile, 'w');
const err = fs.openSync(errFile, 'w');
child.stdout.fd = out;
child.stderr.fd = err;

child.on('close', (code) => {
  fs.closeSync(out);
  fs.closeSync(err);
  console.log('exit code:', code);
});