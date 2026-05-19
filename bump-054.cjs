const fs = require('node:fs');
const path = require('node:path');

const files = [
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/tui/package.json',
  'packages/tools/package.json',
  'packages/providers/package.json',
  'packages/runtime/package.json',
  'packages/mcp/package.json',
  'packages/webui/package.json',
  'packages/telegram/package.json',
  'packages/plug-lsp/package.json',
  'packages/skills/package.json',
];

for (const f of files) {
  const fullPath = path.resolve(f);
  const p = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (p.version === '0.5.3') {
    p.version = '0.5.4';
    fs.writeFileSync(fullPath, JSON.stringify(p, null, 2) + '\n');
    console.log('Updated ' + f);
  }
}