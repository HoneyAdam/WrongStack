import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { AISpecBuilder, AISpecPhase, SpecIndexEntry, SpecStore } from '@wrongstack/core';
import { sddState } from './state.js';

export function getActiveBuilder(): AISpecBuilder | null {
  return sddState.getBuilder();
}

export function getActiveSDDContext(): string | null {
  return sddState.getContext();
}

export function getActiveSDDPhase(): AISpecPhase | null {
  return sddState.getPhase();
}

export async function findSpec(store: SpecStore, idOrTitle: string) {
  if (!idOrTitle) return null;
  const byId = await store.load(idOrTitle);
  if (byId) return byId;
  const all = await store.list();
  const match = all.find(
    (e: SpecIndexEntry) =>
      e.id.startsWith(idOrTitle) || e.title.toLowerCase().includes(idOrTitle.toLowerCase()),
  );
  if (match) return store.load(match.id);
  return null;
}

export async function gatherProjectContext(projectRoot: string): Promise<string> {
  const parts: string[] = [];

  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkgRaw = await fsp.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    parts.push(`Project: ${String(pkg.name ?? 'unknown')}`);
    parts.push(`Description: ${String(pkg.description ?? 'none')}`);
    if (pkg.dependencies) {
      const deps = Object.keys(pkg.dependencies as Record<string, unknown>);
      parts.push(`Dependencies: ${deps.slice(0, 20).join(', ')}${deps.length > 20 ? '...' : ''}`);
    }
    if (pkg.devDependencies) {
      const devDeps = Object.keys(pkg.devDependencies as Record<string, unknown>);
      parts.push(
        `Dev Dependencies: ${devDeps.slice(0, 15).join(', ')}${devDeps.length > 15 ? '...' : ''}`,
      );
    }
  } catch {
    /* no package.json */
  }

  try {
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    await fsp.access(tsconfigPath);
    parts.push('Language: TypeScript');
  } catch {
    /* no tsconfig */
  }

  try {
    const srcDir = path.join(projectRoot, 'src');
    const entries = await fsp.readdir(srcDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (dirs.length > 0) parts.push(`Source structure: src/${dirs.join(', src/')}`);
  } catch {
    /* no src dir */
  }

  return parts.join('\n');
}
