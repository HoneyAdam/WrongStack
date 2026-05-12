import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PathResolver } from '../types/path-resolver.js';

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pnpm-workspace.yaml',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  '.wrongstack',
];

export class DefaultPathResolver implements PathResolver {
  readonly projectRoot: string;
  readonly cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = path.resolve(cwd);
    this.projectRoot = this.detectProjectRoot(this.cwd);
  }

  detectProjectRoot(start: string): string {
    let dir = path.resolve(start);
    const root = path.parse(dir).root;
    while (dir !== root) {
      for (const marker of PROJECT_MARKERS) {
        try {
          fs.accessSync(path.join(dir, marker));
          return dir;
        } catch {
          // continue
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return path.resolve(start);
  }

  resolve(input: string): string {
    const abs = path.isAbsolute(input) ? input : path.resolve(this.cwd, input);
    let real: string;
    try {
      real = fs.realpathSync(abs);
    } catch {
      // path doesn't exist yet; normalize without resolving symlinks
      real = path.normalize(abs);
    }
    return real;
  }

  isInsideRoot(absPath: string): boolean {
    const normalized = path.normalize(absPath);
    const root = path.normalize(this.projectRoot);
    if (normalized === root) return true;
    const rel = path.relative(root, normalized);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  ensureInsideRoot(absPath: string): string {
    const resolved = this.resolve(absPath);
    if (!this.isInsideRoot(resolved)) {
      throw new Error(
        `Path "${absPath}" resolves outside the project root (${this.projectRoot})`,
      );
    }
    return resolved;
  }
}
