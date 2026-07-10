#!/usr/bin/env node
/**
 * Package contract smoke check.
 *
 * Verifies that every publishable workspace package's manifest export
 * targets (main, types, bin, exports) exist on disk after a build. This
 * catches manifest/build drift early — e.g. a package.json that declares
 * `dist/index.js` but the build produces `dist/index.html` only.
 *
 * Run: node scripts/check-package-contracts.mjs
 *
 * Exit 0 = all contracts satisfied, exit 1 = one or more broken.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

// Workspace package directories (mirrors pnpm-workspace.yaml).
const workspaceDirs = ['packages', 'apps'];
const skipPackages = new Set([
  '@wrongstack/desktop', // Electron app — not a publishable npm package in the normal flow
]);

function discoverPackages() {
  const found = [];
  for (const dir of workspaceDirs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const pkgJsonPath = join(abs, entry, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;
      found.push(join(dir, entry));
    }
  }
  return found;
}

function checkTargets(pkgDir) {
  const pkgPath = join(root, pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const errors = [];

  if (skipPackages.has(pkg.name)) return errors;

  const checkPath = (rel) => {
    if (!rel || typeof rel !== 'string') return;
    // Skip non-file specifiers (URLs, globs, special exports).
    if (rel.includes('://') || rel.includes('*')) return;
    const abs = join(root, pkgDir, rel);
    if (!existsSync(abs)) {
      errors.push(`${pkg.name}: missing "${rel}" (referenced in package.json)`);
    }
  };

  // main / types
  if (pkg.main) checkPath(pkg.main);
  if (pkg.types) checkPath(pkg.types);

  // bin
  if (pkg.bin) {
    if (typeof pkg.bin === 'string') {
      checkPath(pkg.bin);
    } else {
      for (const target of Object.values(pkg.bin)) {
        checkPath(target);
      }
    }
  }

  // exports
  if (pkg.exports) {
    for (const [key, value] of Object.entries(pkg.exports)) {
      if (key === './package.json') continue;
      if (typeof value === 'string') {
        checkPath(value);
      } else if (typeof value === 'object' && value !== null) {
        // { types, import, default, ... }
        for (const field of ['types', 'import', 'default', 'require', 'node']) {
          if (value[field]) checkPath(value[field]);
        }
      }
    }
  }

  return errors;
}

// Main
const packages = discoverPackages();
const allErrors = [];

for (const pkgDir of packages) {
  const errors = checkTargets(pkgDir);
  allErrors.push(...errors);
}

if (allErrors.length > 0) {
  console.error(`❌ ${allErrors.length} package contract violation(s) detected:`);
  for (const err of allErrors) {
    console.error(`   ${err}`);
  }
  console.error('Run `pnpm build` to produce the missing dist files.');
  process.exit(1);
} else {
  const checked = packages.filter((d) => {
    const pkg = JSON.parse(readFileSync(join(root, d, 'package.json'), 'utf8'));
    return !skipPackages.has(pkg.name);
  }).length;
  console.log(`✅ All ${checked} publishable package contracts satisfied.`);
}
