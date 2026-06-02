// Test strWidth function
import { strWidth } from './src/markdown-table.js';

console.log('Testing strWidth:');
console.log('✅ strWidth:', strWidth('✅'));
console.log('❌ strWidth:', strWidth('❌'));
console.log('名前 strWidth:', strWidth('名前'));
console.log('Status strWidth:', strWidth('Status'));
console.log('Name strWidth:', strWidth('Name'));
