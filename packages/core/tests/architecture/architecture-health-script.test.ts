import { describe, expect, it } from 'vitest';
import {
  collectModuleSpecifiers,
  findNonCommandSlashImports,
  globToRegExp,
  stronglyConnectedComponents,
  validateHotspotBaseline,
} from '../../../../scripts/lib/architecture-health.mjs';
import {
  parseVitestFileList,
  validateRuntimeTestInventory,
} from '../../../../scripts/lib/test-inventory.mjs';

describe('architecture health scanner', () => {
  it('classifies runtime and type-only module edges', () => {
    const imports = collectModuleSpecifiers(
      [
        "import { value } from './runtime.js';",
        "import type { Contract } from './contract.js';",
        "import { type OtherContract } from './other-contract.js';",
        "export type { PublicContract } from './public-contract.js';",
        "export { publicValue } from './public-value.js';",
        "const lazy = import('./lazy.js');",
        "type LazyContract = import('./lazy-contract.js').LazyContract;",
      ].join('\n'),
      'fixture.ts',
    );

    expect(imports).toEqual([
      { specifier: './runtime.js', typeOnly: false, syntax: 'import' },
      { specifier: './contract.js', typeOnly: true, syntax: 'import' },
      { specifier: './other-contract.js', typeOnly: true, syntax: 'import' },
      { specifier: './public-contract.js', typeOnly: true, syntax: 'export' },
      { specifier: './public-value.js', typeOnly: false, syntax: 'export' },
      { specifier: './lazy.js', typeOnly: false, syntax: 'dynamic-import' },
      { specifier: './lazy-contract.js', typeOnly: true, syntax: 'dynamic-import' },
    ]);
  });

  it('ignores import examples in comments and template fixtures', () => {
    const imports = collectModuleSpecifiers(
      [
        "// import { fake } from './comment.js';",
        "/** @see import('./docs.js').Docs */",
        "const fixture = `import { fake } from './template.js'`;",
        "import { real } from './real.js';",
      ].join('\n'),
      'fixture.ts',
    );

    expect(imports).toEqual([{ specifier: './real.js', typeOnly: false, syntax: 'import' }]);
  });

  it('reports only strongly connected graph components', () => {
    const adjacency = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['a', 'c'])],
      ['c', new Set<string>()],
      ['d', new Set(['d'])],
    ]);

    expect(stronglyConnectedComponents(adjacency.keys(), adjacency)).toEqual([['a', 'b'], ['d']]);
  });

  it('matches zero or more directories for double-star globs', () => {
    const pattern = globToRegExp('tests/**/*.test.ts');
    expect(pattern.test('tests/direct.test.ts')).toBe(true);
    expect(pattern.test('tests/nested/example.test.ts')).toBe(true);
    expect(pattern.test('src/example.test.ts')).toBe(false);
  });

  it('blocks reusable CLI modules from importing command adapters', () => {
    const edges = [
      {
        from: 'packages/cli/src/execution.ts',
        to: 'packages/cli/src/slash-commands/statusline.ts',
      },
      {
        from: 'packages/cli/src/cli-main.ts',
        to: 'packages/cli/src/slash-commands/index.ts',
      },
      {
        from: 'packages/cli/src/slash-commands/statusline.ts',
        to: 'packages/cli/src/slash-commands/helpers.ts',
      },
    ];

    expect(findNonCommandSlashImports(edges)).toEqual([edges[0]]);
  });

  it('requires reviewed hotspot baseline changes for growth and shrinkage', () => {
    const result = validateHotspotBaseline(
      [
        { file: 'src/growing.ts', lines: 900, relativeImports: 8 },
        { file: 'src/shrinking.ts', lines: 850, relativeImports: 3 },
        { file: 'src/new.ts', lines: 801, relativeImports: 1 },
      ],
      {
        thresholdLines: 800,
        files: {
          'src/growing.ts': { lines: 880, relativeImports: 7 },
          'src/shrinking.ts': { lines: 900, relativeImports: 4 },
          'src/deleted.ts': { lines: 810, relativeImports: 2 },
        },
      },
    );

    expect(result.errors).toEqual([
      'src/growing.ts: hotspot grew from 880 to 900 lines; review and update the ratchet in the same change',
      'src/growing.ts: relative import fan-out increased from 7 to 8; review and update the ratchet in the same change',
      'src/shrinking.ts: hotspot shrunk from 900 to 850 lines; review and update the ratchet in the same change',
      'src/shrinking.ts: relative import fan-out decreased from 4 to 3; review and update the ratchet in the same change',
      'src/new.ts: new 801-line hotspot is not in architecture/hotspots.json',
      'src/deleted.ts: stale hotspot baseline; remove or tighten it in the same change',
    ]);
  });

  it('parses and normalizes Vitest file-list JSON', () => {
    expect(
      parseVitestFileList(
        'C:\\repo',
        JSON.stringify([
          { file: 'C:\\repo\\packages\\core\\tests\\b.test.ts' },
          { file: 'C:\\repo\\packages\\core\\tests\\a.test.ts' },
          { file: 'C:\\repo\\packages\\core\\tests\\a.test.ts' },
        ]),
      ),
    ).toEqual(['packages/core/tests/a.test.ts', 'packages/core/tests/b.test.ts']);
  });

  it('rejects zero collection, missing files, unexpected files, and overlapping projects', () => {
    const result = validateRuntimeTestInventory(
      [
        { file: 'packages/a/tests/a.test.ts', projects: ['node'] },
        { file: 'packages/b/tests/b.test.ts', projects: ['jsdom'] },
      ],
      new Map([
        ['node', ['packages/a/tests/a.test.ts', 'packages/extra/tests/x.test.ts']],
        ['jsdom', []],
        ['duplicate', ['packages/a/tests/a.test.ts']],
      ]),
      ['node', 'jsdom', 'duplicate'],
    );

    expect(result.errors).toEqual([
      'node: 1 unexpected test file(s) were collected: packages/extra/tests/x.test.ts',
      'jsdom: Vitest collected zero test files',
      'jsdom: 1 expected test file(s) were not collected: packages/b/tests/b.test.ts',
      'duplicate: 1 unexpected test file(s) were collected: packages/a/tests/a.test.ts',
      'packages/a/tests/a.test.ts: collected by multiple runtime projects: duplicate, node',
    ]);
  });
});
