import { describe, expect, it, vi } from 'vitest';

const { mkdirMock, mockWpaths } = vi.hoisted(() => ({
  mkdirMock: vi.fn().mockResolvedValue(undefined),
  mockWpaths: {
    globalRoot: '/home/testuser/.wrongstack',
    projectDir: '/tmp/test/.wrongstack',
    projectSessions: '/tmp/test/.wrongstack/sessions',
    globalConfig: '/home/testuser/.wrongstack/config.json',
    projectLocalConfig: '/tmp/test/.wrongstack/config.json',
    secretsKey: '/home/testuser/.wrongstack/.key',
    logFile: '/home/testuser/.wrongstack/wrongstack.log',
    configDir: '/home/testuser/.wrongstack',
    modelsCache: '/home/testuser/.wrongstack/models.json',
    projectTrust: '/tmp/test/.wrongstack/trust.json',
  },
}));

vi.mock('node:os', () => ({ homedir: () => '/home/testuser' }));
vi.mock('node:fs/promises', () => ({ mkdir: mkdirMock }));

vi.mock('@wrongstack/core', () => ({
  DefaultConfigLoader: vi.fn().mockImplementation(function(this: any, opts: any) { this.load = vi.fn().mockResolvedValue({ version: 1, provider: 'anthropic', model: 'claude-sonnet-4-20250514', log: { level: 'info' } }); }),
  DefaultLogger: vi.fn().mockImplementation(function(this: any, opts: { level: string; file?: string }) { this.level = opts.level; this.info = vi.fn(); this.warn = vi.fn(); this.error = vi.fn(); this.child = vi.fn().mockReturnThis(); }),
  DefaultPathResolver: vi.fn().mockImplementation(function(this: any, cwd: string) { this.projectRoot = '/tmp/test'; this.resolve = (p: string) => p; }),
  DefaultSecretVault: vi.fn().mockImplementation(function(this: any, opts: any) { this.encrypt = vi.fn(); this.decrypt = vi.fn(); this.isEncrypted = vi.fn(); }),
  migratePlaintextSecrets: vi.fn().mockResolvedValue({ migrated: 0, file: '' }),
  resolveWstackPaths: vi.fn().mockReturnValue(mockWpaths),
}));

import { bootConfig, patchConfig } from '../../src/server/boot.js';

describe('patchConfig', () => {
  it('returns a frozen merge', () => {
    const base = { provider: 'openai', model: 'gpt-5' } as any;
    const result = patchConfig(base, { model: 'gpt-5-mini' });
    expect(result).not.toBe(base);
    expect(result.model).toBe('gpt-5-mini');
    expect(result.provider).toBe('openai');
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('bootConfig', () => {
  it('returns expected shape', async () => {
    const result = await bootConfig();
    expect(result.config.provider).toBe('anthropic');
    expect(result.config.model).toBe('claude-sonnet-4-20250514');
    expect(result.globalConfigPath).toBe('/home/testuser/.wrongstack/config.json');
    expect(result.projectRoot).toBe('/tmp/test');
    expect(result.logger).toBeDefined();
  });

  it('creates required directories', async () => {
    await bootConfig();
    expect(mkdirMock).toHaveBeenCalledWith('/home/testuser/.wrongstack', { recursive: true });
    expect(mkdirMock).toHaveBeenCalledWith('/tmp/test/.wrongstack', { recursive: true });
    expect(mkdirMock).toHaveBeenCalledWith('/tmp/test/.wrongstack/sessions', { recursive: true });
  });
});
