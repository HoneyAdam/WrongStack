// Quick verification — does createChimeraPlugin exist in dist?
import { createChimeraPlugin } from '../packages/core/dist/index.js';

const plugin = createChimeraPlugin();
console.log('Plugin name:', plugin.name);
console.log('Plugin version:', plugin.version);
console.log('Description:', plugin.description);

// Verify the plugin structure
const checks = [
  ['name is string', typeof plugin.name === 'string'],
  ['setup is function', typeof plugin.setup === 'function'],
  ['teardown is function', typeof plugin.teardown === 'function'],
  ['health is function', typeof plugin.health === 'function'],
];

for (const [label, ok] of checks) {
  console.log(ok ? '  ✓' : '  ✗', label);
}

console.log('\nExport verified — plugin is loadable.');
