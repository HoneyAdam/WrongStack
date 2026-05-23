// Run vitest test via require for ESM compatibility
const path = require('path');
const modulePath = path.join(__dirname, 'node_modules', 'vitest', 'dist', 'cli.js');
process.argv = [
  process.execPath,
  modulePath,
  'run',
  path.join(__dirname, 'packages/core/tests/execution/parallel-eternal-engine.test.ts'),
];
require(modulePath);