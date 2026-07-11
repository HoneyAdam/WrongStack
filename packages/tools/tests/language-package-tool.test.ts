import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMocks = vi.hoisted(() => ({ spawnStream: vi.fn() }));
vi.mock('../src/_spawn-stream.js', async (original) => {
  const actual = (await original()) as Record<string, unknown>;
  return { ...actual, spawnStream: spawnMocks.spawnStream };
});

import { languagePackageTool } from '../src/languages/package-tool.js';

let root: string;
const opts = { signal: new AbortController().signal };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-language-package-tool-'));
  spawnMocks.spawnStream.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function context() {
  return {
    cwd: root,
    workingDir: root,
    projectRoot: root,
    recordSideEffect: vi.fn(),
  } as any;
}

const NPM_AUDIT = JSON.stringify({
  vulnerabilities: {
    'lodash@4.17.20': {
      name: 'lodash',
      severity: 'high',
      title: 'Prototype pollution',
      url: 'https://example.test/lodash',
      range: '<4.17.21',
      patched_versions: '>=4.17.21',
    },
  },
});

const NPM_OUTDATED = JSON.stringify({
  react: { current: '17.0.0', wanted: '17.0.2', latest: '18.2.0', type: 'dependencies' },
});

function fakeSpawn(stdout: string, exitCode = 0, stderr = '') {
  return async function* () {
    yield { type: 'partial_output', text: stdout } as const;
    return { stdout, stderr, exitCode, truncated: false };
  };
}

describe('languagePackageTool', () => {
  it('is destructive-rated with package and network capabilities', () => {
    expect(languagePackageTool).toMatchObject({
      name: 'language_package',
      permission: 'confirm',
      mutating: true,
      riskTier: 'destructive',
      capabilities: ['shell.restricted', 'fs.write', 'net.outbound', 'package.install'],
    });
  });

  it('validates required names for add/remove operations', () => {
    expect(languagePackageTool.validate?.({ operation: 'add' })).toContain(
      'operation=add requires at least one name in names',
    );
  });

  it('runs an npm audit and reports vulnerabilities + lockfile diff', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}');
    spawnMocks.spawnStream.mockImplementation(fakeSpawn(NPM_AUDIT));
    const ctx = context();
    const result = await languagePackageTool.execute(
      { operation: 'audit', language: 'javascript' },
      ctx,
      opts,
    );
    expect(result.status).toBe('passed');
    expect(result.vulnerabilities).toEqual([
      expect.objectContaining({ package: 'lodash', severity: 'high' }),
    ]);
    expect(result.mutations).toEqual([]);
    expect(result.lockfilesChanged).toEqual([]);
    expect(ctx.recordSideEffect).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'language_package', risk: 'package' }),
    );
  });

  it('reports outdated packages from npm outdated without mutations', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    spawnMocks.spawnStream.mockImplementation(fakeSpawn(NPM_OUTDATED));
    const result = await languagePackageTool.execute(
      { operation: 'outdated', language: 'javascript' },
      context(),
      opts,
    );
    expect(result.status).toBe('passed');
    expect(result.outdated).toEqual([
      expect.objectContaining({ name: 'react', previous: '17.0.0', resolved: '18.2.0' }),
    ]);
  });

  it('rejects hostile package identifiers before spawning', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    await expect(
      languagePackageTool.execute(
        {
          operation: 'add',
          language: 'javascript',
          names: ['../escape'],
        },
        context(),
        opts,
      ),
    ).rejects.toThrow(/Invalid package|not supported/);
  });

  it('returns structured unavailable output for an unknown profile operation', async () => {
    const result = await languagePackageTool.execute(
      { operation: 'audit', language: 'csharp' },
      context(),
      opts,
    );
    expect(result.status).toBe('unavailable');
  });
});
