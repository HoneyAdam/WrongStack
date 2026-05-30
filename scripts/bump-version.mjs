import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * Collect every package.json that should share the repo version: the root
 * manifest plus every workspace package under packages/* and apps/*.
 * Internal deps use `workspace:*`, so only the `version` field needs updating.
 */
function collectManifests() {
  const paths = [resolve(repoRoot, 'package.json')];
  for (const group of ['packages', 'apps']) {
    const groupDir = resolve(repoRoot, group);
    let entries;
    try {
      entries = readdirSync(groupDir, { withFileTypes: true });
    } catch {
      continue; // group dir may not exist
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = resolve(groupDir, entry.name, 'package.json');
      try {
        readFileSync(candidate); // existence check
        paths.push(candidate);
      } catch {
        // no package.json in this dir — skip
      }
    }
  }
  return paths;
}

function writeVersion(path, version) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

const [, , type, arg] = process.argv;

const rootPath = resolve(repoRoot, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPath, 'utf8'));
const parts = rootPkg.version.split('.').map(Number);

let newVersion;
if (type === 'patch') {
  parts[2] += 1;
  newVersion = parts.join('.');
} else if (type === 'minor') {
  parts[1] += 1;
  parts[2] = 0;
  newVersion = parts.join('.');
} else if (type === 'major') {
  parts[0] += 1;
  parts[1] = 0;
  parts[2] = 0;
  newVersion = parts.join('.');
} else if (type === 'set') {
  if (!arg || !/^\d+\.\d+\.\d+/.test(arg)) {
    console.error('Usage: node bump-version.mjs set <version>');
    process.exit(1);
  }
  newVersion = arg;
} else {
  console.error('Usage: node bump-version.mjs [patch|minor|major|set <version>]');
  process.exit(1);
}

const manifests = collectManifests();
for (const path of manifests) {
  writeVersion(path, newVersion);
}

console.log(
  `Version ${type === 'set' ? 'set' : 'bumped'} to ${newVersion} across ${manifests.length} package(s).`,
);
