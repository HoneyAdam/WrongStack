import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const [,, type] = process.argv;

const parts = pkg.version.split('.').map(Number);
const [major, minor, patch] = parts;

if (type === 'patch') {
  parts[2] += 1;
} else if (type === 'minor') {
  parts[1] += 1;
  parts[2] = 0;
} else if (type === 'major') {
  parts[0] += 1;
  parts[1] = 0;
  parts[2] = 0;
} else if (type === 'set') {
  const newVersion = process.argv[3];
  if (!newVersion) {
    console.error('Usage: node bump-version.mjs set <version>');
    process.exit(1);
  }
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Version set to ${newVersion}`);
  process.exit(0);
} else {
  console.error('Usage: node bump-version.mjs [patch|minor|major|set <version>]');
  process.exit(1);
}

pkg.version = parts.join('.');
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Version bumped to ${pkg.version}`);