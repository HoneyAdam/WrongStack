import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DefaultSecretVault,
  type ModelsRegistry,
  type ResolvedProvider,
} from '@wrongstack/core';
import { runAuthDirect, runAuthMenu, type AuthMenuDeps } from '../src/auth-menu.js';
import type { TerminalRenderer } from '../src/renderer.js';
import type { ReadlineInputReader } from '../src/input-reader.js';

/**
 * V0-C: `auth-menu` is the 776-line entry point for every API-key
 * interaction. We don't aim to drive the full interactive `runAuthMenu`
 * loop — that's an integration test best done by hand. Here we pin:
 *
 *  1. `runAuthDirect` (the scripted one-shot) writes encrypted keys to
 *     the right config shape.
 *  2. Catalog-driven defaults (family/baseUrl/envVars) are pulled when
 *     the provider exists in models.dev.
 *  3. Missing family + missing catalog entry fails with exit 1.
 *  4. Label collisions append a `-2`, `-3`, … suffix.
 *  5. `runAuthMenu` exits cleanly on `q`.
 */

async function mkTempDir(prefix = 'wstack-auth-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function makeRenderer(): TerminalRenderer {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeBlock: vi.fn(),
    writeToolCall: vi.fn(),
    writeToolResult: vi.fn(),
    writeDiff: vi.fn(),
    writeWarning: vi.fn(),
    writeError: vi.fn(),
    writeInfo: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
  } as unknown as TerminalRenderer;
}

function makeReader(lines: string[], secrets: string[] = []): ReadlineInputReader {
  let li = 0;
  let si = 0;
  return {
    readLine: vi.fn(async () => {
      if (li >= lines.length) throw new Error('EOF');
      return lines[li++] ?? '';
    }),
    readSecret: vi.fn(async () => {
      if (si >= secrets.length) throw new Error('EOF (secret)');
      return secrets[si++] ?? '';
    }),
    close: vi.fn(async () => {}),
  } as unknown as ReadlineInputReader;
}

function makeModelsRegistry(catalog: Record<string, Partial<ResolvedProvider>>): ModelsRegistry {
  return {
    getProvider: vi.fn(async (id: string) => (catalog[id] ? (catalog[id] as ResolvedProvider) : undefined)),
    listProviders: vi.fn(async () => Object.values(catalog) as ResolvedProvider[]),
    suggestModel: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
  } as unknown as ModelsRegistry;
}

async function setupDeps(opts: {
  catalog?: Record<string, Partial<ResolvedProvider>>;
  preExisting?: object;
  scripted?: { lines?: string[]; secrets?: string[] };
}): Promise<{ deps: AuthMenuDeps; configPath: string; tmpDir: string }> {
  const tmpDir = await mkTempDir();
  const configPath = path.join(tmpDir, 'config.json');
  if (opts.preExisting) {
    await fs.writeFile(configPath, JSON.stringify(opts.preExisting), { mode: 0o600 });
  }
  const vault = new DefaultSecretVault({ keyFile: path.join(tmpDir, '.key') });
  const deps: AuthMenuDeps = {
    renderer: makeRenderer(),
    reader: makeReader(opts.scripted?.lines ?? [], opts.scripted?.secrets ?? []),
    modelsRegistry: makeModelsRegistry(opts.catalog ?? {}),
    vault,
    globalConfigPath: configPath,
  };
  return { deps, configPath, tmpDir };
}

describe('runAuthDirect', () => {
  it('writes encrypted key for a known catalog provider', async () => {
    const { deps, configPath } = await setupDeps({
      catalog: {
        anthropic: {
          id: 'anthropic',
          family: 'anthropic',
          apiBase: 'https://api.anthropic.com',
          envVars: ['ANTHROPIC_API_KEY'],
        },
      },
      scripted: { secrets: ['sk-test-abc'] },
    });

    const code = await runAuthDirect(deps, { providerId: 'anthropic' });
    expect(code).toBe(0);

    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(raw.providers.anthropic).toBeDefined();
    // Encrypted-at-rest — must NOT contain the plaintext key
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain('sk-test-abc');
    // Catalog defaults flowed in
    expect(raw.providers.anthropic.family).toBe('anthropic');
    expect(raw.providers.anthropic.baseUrl).toBe('https://api.anthropic.com');
    expect(raw.providers.anthropic.envVars).toEqual(['ANTHROPIC_API_KEY']);
    expect(raw.providers.anthropic.activeKey).toBe('default');
  });

  it('exits 1 when provider unknown and no --family passed', async () => {
    const { deps } = await setupDeps({ catalog: {} });
    const code = await runAuthDirect(deps, { providerId: 'unknown-provider' });
    expect(code).toBe(1);
    expect(deps.renderer.writeError).toHaveBeenCalledWith(
      expect.stringContaining('not in catalog'),
    );
  });

  it('explicit --family bypasses catalog requirement', async () => {
    const { deps } = await setupDeps({
      catalog: {},
      scripted: { secrets: ['sk-custom'] },
    });
    const code = await runAuthDirect(deps, {
      providerId: 'self-hosted',
      family: 'openai-compatible',
      baseUrl: 'https://my.api/v1',
    });
    expect(code).toBe(0);
  });

  it('label collision suffixes -2, -3, …', async () => {
    const { deps, configPath } = await setupDeps({
      catalog: {
        anthropic: {
          id: 'anthropic',
          family: 'anthropic',
          envVars: ['ANTHROPIC_API_KEY'],
        },
      },
      scripted: { secrets: ['k1', 'k2', 'k3'] },
    });

    await runAuthDirect(deps, { providerId: 'anthropic' });
    await runAuthDirect(deps, { providerId: 'anthropic' });
    await runAuthDirect(deps, { providerId: 'anthropic' });

    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const labels = (raw.providers.anthropic.apiKeys as { label: string }[]).map((k) => k.label).sort();
    expect(labels).toEqual(['default', 'default-2', 'default-3']);
    expect(deps.renderer.writeInfo).toHaveBeenCalledWith(
      expect.stringMatching(/Label collided/),
    );
  });

  it('empty secret input returns exit 1', async () => {
    const { deps } = await setupDeps({
      catalog: {
        anthropic: { id: 'anthropic', family: 'anthropic', envVars: ['X'] },
      },
      scripted: { secrets: [''] },
    });
    const code = await runAuthDirect(deps, { providerId: 'anthropic' });
    expect(code).toBe(1);
    expect(deps.renderer.writeError).toHaveBeenCalledWith('No key entered.');
  });
});

describe('runAuthMenu', () => {
  it('exits with 0 on "q"', async () => {
    const { deps } = await setupDeps({
      scripted: { lines: ['q'] },
    });
    const code = await runAuthMenu(deps);
    expect(code).toBe(0);
  });

  it('exits with 0 on empty input', async () => {
    const { deps } = await setupDeps({
      scripted: { lines: [''] },
    });
    const code = await runAuthMenu(deps);
    expect(code).toBe(0);
  });
});
