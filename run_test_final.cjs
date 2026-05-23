// Run vitest test by spawning node with the vitest cli entry point
const path = require('path');
const { spawn } = require('child_process');

const vitestMain = path.join(__dirname, 'node_modules', 'vitest', 'dist', 'cli.js');
const testFile = path.join(__dirname, 'packages', 'core', 'tests', 'execution', 'parallel-eternal-engine.test.ts');

console.log('vitest:', vitestMain);
console.log('test:', testFile);

const child = spawn(process.execPath, [vitestMain, 'run', testFile, '--reporter=verbose'], {
  cwd: __dirname,
  stdio: 'inherit',
  timeout: 90000,
});

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => { console.error(err); process.exit(1); });