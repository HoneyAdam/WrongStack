import fs from 'node:fs';
import path from 'node:path';

const pkgsDir = path.resolve('packages');
const pkgs = fs.readdirSync(pkgsDir).filter(p => fs.statSync(path.join(pkgsDir, p)).isDirectory());

function countFiles(dir, ext, excludeTestExt) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir, {withFileTypes: true})) {
    if (f.isDirectory()) n += countFiles(path.join(dir, f.name), ext, excludeTestExt);
    else if (f.name.endsWith(ext) && (!excludeTestExt || !(f.name.endsWith('.test.ts') || f.name.endsWith('.spec.ts')))) n++;
  }
  return n;
}

let totalSrc = 0, totalTests = 0;
for (const pkg of pkgs) {
  const srcDir = path.join(pkgsDir, pkg, 'src');
  const testDir = path.join(pkgsDir, pkg, 'tests');
  const srcCount = countFiles(srcDir, '.ts', true);
  const testCount = countFiles(testDir, '.test.ts', false);
  totalSrc += srcCount;
  totalTests += testCount;
  console.log(pkg + ': ' + srcCount + ' src files, ' + testCount + ' test files');
}
console.log('Total: ' + totalSrc + ' src files, ' + totalTests + ' test files');
