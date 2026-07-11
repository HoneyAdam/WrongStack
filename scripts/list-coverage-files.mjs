import fs from 'node:fs';
import path from 'node:path';

const pkgsDir = path.resolve('packages');
const pkgs = fs.readdirSync(pkgsDir).filter(p => fs.statSync(path.join(pkgsDir, p)).isDirectory());

// Files excluded from coverage (matches vitest.config.ts exclusions)
const excludePatterns = [
  '**/*.test.ts', '**/*.bench.ts', '**/tests/**', '**/dist/**',
  'packages/tools/src/grep.ts',
  'packages/tools/src/_env.ts',
  'packages/*/src/index.ts',
  '**/types/**',
  'packages/*/src/test-helpers/**',
  'packages/cli/src/input-reader.ts',
  'packages/cli/src/repl.ts',
  'packages/cli/src/spinner.ts',
  'packages/tui/src/app.tsx',
  'packages/tui/src/components/**/*.tsx',
  'packages/tui/src/hooks/**/*.ts',
  'packages/tui/src/app-reducer.ts',
  'packages/tui/src/run-tui.ts',
  'packages/tui/src/clipboard.ts',
  'packages/runtime/src/pack.ts',
  'packages/webui/src/lib/chime.ts',
  'packages/webui/src/lib/favicon.ts',
  'packages/webui/src/lib/notify.ts',
  'packages/webui/src/lib/utils.ts',
  'packages/webui/src/lib/ws-client.ts',
  'packages/webui/src/components/**/*.tsx',
  'packages/webui/src/hooks/**/*.ts',
  'packages/webui/src/stores/**/*.ts',
  'packages/webui/src/server/index.ts',
  'packages/webui-server/src/server/index.ts',
  'packages/webui-server/src/server/entry.ts',
  'packages/plug-lsp/src/tools/codebase-lsp-search.ts',
  'packages/plug-lsp/src/tools/lsp-search.ts',
  'packages/plug-lsp/src/tools/codebase-index/index.ts',
  'packages/tools/src/shim/**/*.ts',
  'packages/plug-lsp/src/auto-doc/ts-parser.ts',
  'packages/plug-lsp/src/auto-doc/rs-parser.ts',
  'packages/plug-lsp/src/auto-doc/go-parser.ts',
  'packages/plug-lsp/src/auto-doc/py-parser.ts',
  'packages/plug-lsp/src/auto-doc/sh-parser.ts',
];

function shouldExclude(filePath) {
  const rel = path.relative(pkgsDir, filePath).replace(/\\/g, '/');
  for (const pattern of excludePatterns) {
    // Convert glob to regex
    let regexStr = '^' + pattern
      .replace(/\*\*/g, '___GLOBSTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___GLOBSTAR___/g, '.*');
    const regex = new RegExp(regexStr);
    if (regex.test(rel)) return true;
  }
  return false;
}

function listFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const f of fs.readdirSync(dir, {withFileTypes: true})) {
    const fp = path.join(dir, f.name);
    if (f.isDirectory()) listFiles(fp, result);
    else if (f.name.endsWith('.ts') && !f.name.endsWith('.test.ts') && !f.name.endsWith('.spec.ts')) {
      result.push(fp);
    }
  }
  return result;
}

for (const pkg of pkgs) {
  const srcDir = path.join(pkgsDir, pkg, 'src');
  if (!fs.existsSync(srcDir)) continue;
  const allFiles = listFiles(srcDir);
  const included = allFiles.filter(f => !shouldExclude(f));
  const excluded = allFiles.filter(f => shouldExclude(f));
  if (included.length > 0) {
    console.log(`\n=== ${pkg} ===`);
    console.log(`  Included in coverage: ${included.length} files`);
    for (const f of included) {
      const rel = path.relative(pkgsDir, f);
      const lines = fs.readFileSync(f, 'utf-8').split('\n').length;
      console.log(`    ${rel} (${lines} lines)`);
    }
    if (excluded.length > 0) {
      console.log(`  Excluded from coverage: ${excluded.length} files`);
      for (const f of excluded) {
        const rel = path.relative(pkgsDir, f);
        console.log(`    ${rel} (excluded)`);
      }
    }
  }
}
