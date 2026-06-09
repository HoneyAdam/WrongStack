const fs = require('fs');
const c = fs.readFileSync('packages/core/dist/index.js', 'utf8');
const matches = c.match(/chimera/gi);
if (matches) {
  console.log('Found', matches.length, 'occurrences of "chimera"');
  // Print surrounding context
  const idx = c.indexOf('createChimeraPlugin');
  if (idx >= 0) {
    console.log('createChimeraPlugin found at offset', idx);
    console.log(c.slice(Math.max(0, idx - 50), idx + 100));
  }
} else {
  console.log('NOT FOUND — createChimeraPlugin not in dist/index.js');
}
