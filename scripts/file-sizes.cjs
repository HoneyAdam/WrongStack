const fs = require('node:fs');
const path = require('node:path');

const files = [];

function walk(d) {
  const entries = fs.readdirSync(d, { withFileTypes: true });
  for (const f of entries) {
    const fp = path.join(d, f.name);
    if (f.isDirectory() && !f.name.match(/node_modules|dist|tests/)) {
      walk(fp);
    } else if (f.name.endsWith('.ts') && !f.name.match(/\.test\.ts|\.spec\.ts/)) {
      const content = fs.readFileSync(fp, 'utf8');
      const n = content.split('\n').length;
      files.push({ p: fp.replace(process.cwd(), '.'), n });
    }
  }
}

walk('packages');
files.sort((a, b) => b.n - a.n);
files.slice(0, 50).forEach((f) => {
  console.log(f.n + '\t' + f.p);
});
