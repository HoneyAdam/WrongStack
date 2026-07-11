import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pkgsDir = path.resolve('packages');
const pkgs = fs.readdirSync(pkgsDir).filter(p => fs.statSync(path.join(pkgsDir, p)).isDirectory());

for (const pkg of pkgs) {
  const testDir = path.join(pkgsDir, pkg, 'tests');
  if (!fs.existsSync(testDir)) {
    console.log(`${pkg}: NO_TESTS`);
    continue;
  }
  const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
  if (testFiles.length === 0) {
    console.log(`${pkg}: NO_TESTS`);
    continue;
  }
  
  const testArgs = testFiles.map(f => `packages/${pkg}/tests/${f}`).join(' ');
  try {
    const result = execSync(
      `pnpm exec vitest run --coverage --coverage.include="packages/${pkg}/src/**/*.ts" --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 ${testArgs}`,
      { cwd: path.resolve('.'), timeout: 60000, encoding: 'utf-8' }
    );
    // Extract the coverage table
    const lines = result.split('\n');
    let inCoverage = false;
    let coverageData = [];
    for (const line of lines) {
      if (line.includes('% Coverage report from v8')) { inCoverage = true; continue; }
      if (inCoverage && line.includes('------------------')) continue;
      if (inCoverage && line.trim() === '') continue;
      if (inCoverage) coverageData.push(line);
    }
    console.log(`\n=== ${pkg} ===`);
    console.log(coverageData.slice(0, 30).join('\n').substring(0, 2000));
  } catch (e) {
    console.log(`${pkg}: ERROR - ${e.message.substring(0, 100)}`);
  }
}
