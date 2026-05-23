// Direct test runner using vitest as a library
const path = require('path');
const { execSync } = require('child_process');

// Find vitest
const vitestPath = path.join(__dirname, 'node_modules', 'vitest');
const vitest = require(vitestPath);

const testFile = path.join(__dirname, 'packages/core/tests/execution/parallel-eternal-engine.test.ts');
console.log('Running:', testFile);

// Use vitest's CLI programmatically via the bundled runner
process.argv = ['node', 'vitest', 'run', testFile, '--reporter=verbose'];
vitest.run();