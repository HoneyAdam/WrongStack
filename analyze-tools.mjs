import { builtinTools, TIER1_TOOLS, OPTIONAL_TOOLS } from './packages/tools/dist/builtin.js';

console.log('Total builtin tools:', builtinTools.length);
console.log('TIER1 tools:', TIER1_TOOLS.length);
console.log('OPTIONAL tools:', OPTIONAL_TOOLS.length);
console.log('');
console.log('TIER1:', TIER1_TOOLS.map(t => t.name).join(', '));
console.log('');
console.log('In builtin but NOT TIER1:', builtinTools.filter(t => !TIER1_TOOLS.find(t1 => t1.name === t.name)).map(t => t.name).join(', '));
console.log('');
console.log('OPTIONAL tools:', OPTIONAL_TOOLS.map(t => t.name).join(', '));
