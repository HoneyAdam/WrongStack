import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ancestorPaths,
  normalizeProjectPath,
  normalizeSlashes,
  resolveSuperMemoryPaths,
} from '../src/paths.js';

describe('normalizeSlashes', () => {
  it('replaces backslashes with forward slashes', () => {
    expect(normalizeSlashes('a\\b\\c')).toBe('a/b/c');
  });

  it('collapses multiple slashes', () => {
    expect(normalizeSlashes('a//b///c')).toBe('a/b/c');
  });

  it('leaves already-normalized paths unchanged', () => {
    expect(normalizeSlashes('a/b/c')).toBe('a/b/c');
  });
});

describe('ancestorPaths', () => {
  it('returns [.] for root path', () => {
    expect(ancestorPaths('.')).toEqual(['.']);
  });

  it('returns all ancestor prefixes', () => {
    expect(ancestorPaths('a/b/c')).toEqual(['a/b/c', 'a/b', 'a']);
  });

  it('handles single-level path', () => {
    expect(ancestorPaths('src')).toEqual(['src']);
  });

  it('normalizes slashes before computing', () => {
    expect(ancestorPaths('a\\b\\c')).toEqual(['a/b/c', 'a/b', 'a']);
  });
});

describe('normalizeProjectPath', () => {
  it('returns relative path unchanged when already inside project', () => {
    const result = normalizeProjectPath('/project', 'src/file.ts');
    expect(result).toBe('src/file.ts');
  });

  it('resolves absolute path inside project', () => {
    const result = normalizeProjectPath('/project', '/project/src/file.ts');
    expect(result).toBe('src/file.ts');
  });

  it('throws for path outside project', () => {
    expect(() => normalizeProjectPath('/project', '../outside.ts')).toThrow(/inside the project root/i);
  });

  it('rejects absolute path outside project', () => {
    expect(() => normalizeProjectPath('/project', '/other/src/file.ts')).toThrow(/inside the project root/i);
  });
});

describe('resolveSuperMemoryPaths', () => {
  it('throws for absolute directory', () => {
    expect(() => resolveSuperMemoryPaths('/project', '/absolute/path')).toThrow(/project-relative/i);
  });

  it('throws for directory escaping project root', () => {
    expect(() => resolveSuperMemoryPaths('/project', '../escape')).toThrow(/project root/i);
  });

  it('returns all expected sub-paths for a valid directory', () => {
    const paths = resolveSuperMemoryPaths('/project', '.wrongstack/memories');
    expect(paths.rootDir).toBe(path.resolve('/project/.wrongstack/memories'));
    expect(paths.manifest).toContain('manifest.json');
    expect(paths.memoriesLog).toContain('memories.jsonl');
    expect(paths.candidatesLog).toContain('candidates.jsonl');
    expect(paths.auditLog).toContain('audit.jsonl');
    expect(paths.graphDir).toContain('graph');
    expect(paths.edgesLog).toContain('edges.jsonl');
    expect(paths.indexesDir).toContain('indexes');
    expect(paths.snapshotsDir).toContain('snapshots');
    expect(paths.hygieneDir).toContain('hygiene');
    expect(paths.tmpDir).toContain('tmp');
    expect(paths.locksDir).toContain('locks');
  });
});
