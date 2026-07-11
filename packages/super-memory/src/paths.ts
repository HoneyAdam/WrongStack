import * as path from 'node:path';
import type { SuperMemoryPaths } from './types.js';

export const DEFAULT_SUPER_MEMORY_DIR = '.wrongstack/memories';

export function resolveSuperMemoryPaths(
  projectRoot: string,
  directory = DEFAULT_SUPER_MEMORY_DIR,
): SuperMemoryPaths {
  if (path.isAbsolute(directory)) {
    throw new Error('Super Memory directory must be project-relative.');
  }
  const resolvedProjectRoot = path.resolve(projectRoot);
  const rootDir = path.resolve(resolvedProjectRoot, directory);
  const relative = path.relative(resolvedProjectRoot, rootDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Super Memory directory must stay inside the project root.');
  }
  return {
    rootDir,
    manifest: path.join(rootDir, 'manifest.json'),
    memoriesLog: path.join(rootDir, 'memories.jsonl'),
    candidatesLog: path.join(rootDir, 'candidates.jsonl'),
    auditLog: path.join(rootDir, 'audit.jsonl'),
    graphDir: path.join(rootDir, 'graph'),
    edgesLog: path.join(rootDir, 'graph', 'edges.jsonl'),
    indexesDir: path.join(rootDir, 'indexes'),
    snapshotsDir: path.join(rootDir, 'snapshots'),
    hygieneDir: path.join(rootDir, 'hygiene'),
    tmpDir: path.join(rootDir, 'tmp'),
    locksDir: path.join(rootDir, 'locks'),
  };
}

export function normalizeProjectPath(projectRoot: string, inputPath: string): string {
  const root = path.resolve(projectRoot);
  const abs = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(root, inputPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Memory path must stay inside the project root: ${inputPath}`);
  }
  return normalizeSlashes(rel || '.');
}

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function ancestorPaths(projectPath: string): string[] {
  const normalized = normalizeSlashes(projectPath);
  if (normalized === '.') return ['.'];
  const parts = normalized.split('/').filter(Boolean);
  const result: string[] = [];
  for (let i = parts.length; i >= 1; i--) {
    result.push(parts.slice(0, i).join('/'));
  }
  return result;
}
