const c = require('./kanban-coverage.json');
for (const [k, v] of Object.entries(c.coverageMap)) {
  const parts = k.replace(/\\/g, '/').split('/');
  const path = parts.slice(-3).join('/');
  
  const uncoveredStmts = Object.keys(v.statementMap).filter(i => !v.s[i] || v.s[i] === 0);
  const uncoveredBranches = Object.keys(v.branchMap || {}).filter(i => {
    const branchHits = v.b[i] || {};
    return Object.values(branchHits).every(x => x === 0);
  });
  const uncoveredFns = Object.keys(v.fnMap || {}).filter(i => !v.f[i] || v.f[i] === 0);
  
  console.log(`\n${path}`);
  if (uncoveredStmts.length) {
    console.log('  uncovered stmts:');
    for (const s of uncoveredStmts) {
      const stmt = v.statementMap[s];
      const line = stmt.start.line;
      // Get the actual source line for context
      console.log(`    L${line}:${stmt.start.column}-L${stmt.end.line}:${stmt.end.column}`);
    }
  }
  if (uncoveredBranches.length) {
    console.log('  uncovered branches at lines:', uncoveredBranches.map(b => 'L' + v.branchMap[b].line).join(', '));
  }
  if (uncoveredFns.length) {
    console.log('  uncovered fns:', uncoveredFns.map(f => v.fnMap[f].name).join(', '));
  }
  if (!uncoveredStmts.length && !uncoveredBranches.length && !uncoveredFns.length) {
    console.log('  100% covered');
  }
}
