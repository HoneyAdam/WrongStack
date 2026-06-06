#!/usr/bin/env node
/**
 * Workspace build runner — bypasses `pnpm -r build` to work around
 * pnpm 11's `; echo "EXIT=$?"` wrapper, which cmd.exe (the default
 * script-shell on Windows) does not understand as a separator. The
 * wrapper is passed as literal args to tsup, which then fails with
 * "Cannot find ;,echo,...". pnpm 11.5.2 + cmd.exe has no clean
 * `script-shell` setting, so we run each workspace package's `build`
 * script directly via cmd.exe here. cmd.exe handles `&&` correctly,
 * so chained scripts like `vite build && tsup` keep working.
 *
 * Workspace layout is mirrored from pnpm-workspace.yaml (packages/*
 * apps/* and website). Update both together if packages move.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

const workspaceGlobs = [
  ['packages', true],
  ['apps', true],
  ['website', false],
];

function discoverPackages() {
  const found = [];
  for (const [dir] of workspaceGlobs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const child = join(abs, entry);
      if (!existsSync(join(child, 'package.json'))) continue;
      found.push(relative(root, child));
    }
  }
  return found;
}

function readBuildScript(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(root, pkgDir, 'package.json'), 'utf8'));
  return pkg.scripts?.build ?? null;
}

function runBuild(pkgDir, script) {
  const shell = process.env.ComSpec || 'cmd.exe';
  console.log(`\n> ${pkgDir} > ${script}`);
  const result = spawnSync(shell, ['/c', script], {
    cwd: join(root, pkgDir),
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  });
  if (result.status !== 0) {
    console.error(`\nBuild failed in ${pkgDir} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

const pkgs = discoverPackages();
if (pkgs.length === 0) {
  console.error('No workspace packages found.');
  process.exit(1);
}

for (const pkg of pkgs) {
  const script = readBuildScript(pkg);
  if (!script) {
    console.log(`> ${pkg} — no build script, skipping`);
    continue;
  }
  runBuild(pkg, script);
}

console.log('\nBuild complete.');
