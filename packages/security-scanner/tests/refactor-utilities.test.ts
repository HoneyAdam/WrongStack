import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gatherFiles, shouldExcludeDir } from '../src/file-gathering.js';
import { extractJsonBlock } from '../src/json-extractor.js';
import { parseNodeDependencies } from '../src/manifest-parser.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('shared file gathering', () => {
  it('filters extensions, hidden directories, and glob-style exclusions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'security-gather-'));
    temporaryDirectories.push(root);
    const files = {
      'src/index.ts': 'ok',
      'src/index.js': 'skip extension',
      'src/.env': 'ok dotfile',
      'packages/a/generated/unsafe.ts': 'skip glob',
      'generated/root.ts': 'skip root glob',
      '.cache/hidden.ts': 'skip hidden',
    };
    for (const [file, content] of Object.entries(files)) {
      const fullPath = path.join(root, file);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    const gathered = await gatherFiles({
      root,
      extensions: ['.ts', '.env'],
      maxDepth: 10,
      excludePatterns: ['**/generated/**'],
      excludeHidden: true,
    });

    expect(gathered.map((file) => path.relative(root, file).replace(/\\/g, '/'))).toEqual([
      'src/.env',
      'src/index.ts',
    ]);
    expect(shouldExcludeDir('dist', 'packages/a/dist', ['dist'])).toBe(true);
  });
});

describe('LLM JSON extraction', () => {
  it('extracts nested JSON from a markdown fence and ignores braces in strings', () => {
    const text =
      'Result:\n```json\n{"outer":{"text":"a } brace"},"items":[1,2]}\n```\ntrailing {noise}';
    expect(extractJsonBlock(text, 'object')).toBe('{"outer":{"text":"a } brace"},"items":[1,2]}');
  });

  it('extracts an array containing nested objects and bracket characters', () => {
    const text = 'prefix [{"value":"]","nested":{"ok":true}}] suffix [not-json]';
    expect(extractJsonBlock(text, 'array')).toBe('[{"value":"]","nested":{"ok":true}}]');
  });
});

describe('Node manifest parsing', () => {
  it('parses and de-duplicates runtime and development dependencies', () => {
    const dependencies = parseNodeDependencies(
      JSON.stringify({
        dependencies: { alpha: '^1.0.0', shared: '^2.0.0' },
        devDependencies: { beta: '~3.0.0', shared: 'workspace:*' },
        optionalDependencies: { optional: '4.0.0' },
      }),
    );
    expect(dependencies).toEqual([
      { name: 'alpha', version: '^1.0.0', isDev: false },
      { name: 'beta', version: '~3.0.0', isDev: true },
      { name: 'optional', version: '4.0.0', isDev: false },
      { name: 'shared', version: '^2.0.0', isDev: false },
    ]);
  });

  it('returns an empty list for malformed manifests', () => {
    expect(parseNodeDependencies('{bad json')).toEqual([]);
  });
});
