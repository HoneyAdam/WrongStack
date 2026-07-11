import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const pkg = process.argv[2] || 'kanban';
const root = path.resolve('.');

const testDir = path.join('packages', pkg, 'tests');
const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
const testPaths = testFiles.map(f => `packages/${pkg}/tests/${f}`).join(' ');

const cmd = `pnpm exec vitest run --coverage --coverage.include="packages/${pkg}/src/**/*.ts" --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 --reporter=json ${testPaths}`;

let stdout = '';
try {
  stdout = execSync(cmd, { cwd: root, timeout: 60000, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
} catch (e) {
  stdout = e.stdout || '';
}

// Find JSON — the test results and coverage are interleaved
const jsonStart = stdout.indexOf('{');
if (jsonStart === -1) { console.error('No JSON found'); process.exit(1); }
const jsonStr = stdout.slice(jsonStart);

const report = JSON.parse(jsonStr);
const coverageMap = report.coverageMap;

for (const filePath of Object.keys(coverageMap)) {
  if (!filePath.includes(`packages/${pkg}/src`)) continue;
  if (!filePath.endsWith('.ts')) continue;
  if (filePath.includes('/tests/') || filePath.includes('/dist/')) continue;
  
  const fileCov = coverageMap[filePath];
  const relPath = path.relative(root, filePath);
  
  const statementKeys = Object.keys(fileCov.s);
  const uncoveredStatements = statementKeys.filter(k => fileCov.s[k] === 0);
  const coveredStatements = statementKeys.filter(k => fileCov.s[k] > 0);
  
  console.log(`\n${relPath}`);
  console.log(`  Statements: ${coveredStatements.length}/${statementKeys.length} uncovered statement ids: ${uncoveredStatements.join(',') || 'none'}`);
  
  if (fileCov.branchMap) {
    const branchKeys = Object.keys(fileCov.b);
    const problemBranches = branchKeys.filter(b => {
      return fileCov.b[b].some(h => h === 0);
    });
    if (problemBranches.length > 0) {
      console.log(`  Branch issues at branch ids: ${problemBranches.join(',')}`);
      for (const bId of problemBranches) {
        const b = fileCov.branchMap[bId];
        const hits = fileCov.b[bId];
        const hitStr = hits.map((h, i) => `loc${i}=${h}`).join(', ');
        console.log(`    Branch #${bId} line ${b.line} type=${b.type} locs=${b.locations.length} ${hitStr}`);
      }
    }
  }
  
  if (fileCov.fnMap) {
    const fnKeys = Object.keys(fileCov.f);
    const uncoveredFns = fnKeys.filter(k => fileCov.f[k] === 0);
    if (uncoveredFns.length > 0) {
      console.log(`  Uncovered functions at fn ids: ${uncoveredFns.join(',')}`);
      for (const fId of uncoveredFns) {
        const fn = fileCov.fnMap[fId];
        console.log(`    Func "${fn.name}" line ${fn.line}`);
      }
    }
  }
}
