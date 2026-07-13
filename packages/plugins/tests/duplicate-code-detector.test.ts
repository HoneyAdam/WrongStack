import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Virtual filesystem mock
// ---------------------------------------------------------------------------

type FsEntry = { type: 'file'; content: string } | { type: 'dir' };

let mockFs: Record<string, FsEntry> = {};

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function mockReaddirSync(p: string, options?: { withFileTypes?: boolean }) {
  const dir = normalizePath(p).replace(/\/$/, '') || '/';
  const entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[] = [];
  for (const [path, entry] of Object.entries(mockFs)) {
    const normalized = normalizePath(path).replace(/\/$/, '') || '/';
    const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) || '/' : '/';
    if (parent === dir) {
      const name = normalized.split('/').pop()!;
      entries.push({
        name,
        isDirectory: () => entry.type === 'dir',
        isFile: () => entry.type === 'file',
      });
    }
  }
  if (options?.withFileTypes) return entries;
  return entries.map((e) => e.name);
}

function mockReadFileSync(p: string, encoding?: string) {
  const normalized = normalizePath(p);
  const entry = mockFs[normalized];
  if (entry?.type !== 'file') {
    const err = new Error(`ENOENT: ${normalized}`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }
  if (encoding === 'utf-8' || encoding === 'utf8') return entry.content;
  return Buffer.from(entry.content);
}

function mockExistsSync(p: string) {
  const normalized = normalizePath(p);
  return normalized in mockFs;
}

function mockStatSync(p: string) {
  const normalized = normalizePath(p);
  const entry = mockFs[normalized];
  if (!entry) {
    const err = new Error(`ENOENT: ${normalized}`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }
  return {
    isDirectory: () => entry.type === 'dir',
    isFile: () => entry.type === 'file',
  };
}

vi.mock('node:fs', () => ({
  existsSync: vi.fn(mockExistsSync),
  readFileSync: vi.fn(mockReadFileSync),
  readdirSync: vi.fn(mockReaddirSync),
  statSync: vi.fn(mockStatSync),
}));

const plugin = (await import('../src/duplicate-code-detector')).default;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockApi {
  tools: { register: ReturnType<typeof vi.fn> };
  config: { extensions: Record<string, unknown> };
  log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  metrics: { counter: ReturnType<typeof vi.fn> };
  registerHook: ReturnType<typeof vi.fn>;
}

function makeApi(overrides: { extensions?: Record<string, unknown>; enabled?: boolean } = {}): MockApi {
  return {
    tools: { register: vi.fn() },
    config: {
      extensions:
        overrides.extensions ??
        (overrides.enabled === true ? { 'duplicate-code-detector': { enabled: true } } : {}),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    metrics: { counter: vi.fn() },
    registerHook: vi.fn(() => vi.fn()),
  };
}

function getTool(api: MockApi, name: string): (input: unknown) => Promise<unknown> {
  const call = api.tools.register.mock.calls.find(
    ([t]: unknown[]) => (t as { name: string }).name === name,
  );
  if (!call) throw new Error(`tool ${name} not registered`);
  return (call[0] as { execute: (input: unknown) => Promise<unknown> }).execute;
}

type HookResult = { decision?: string; reason?: string; additionalContext?: string } | undefined;

function getHook(api: MockApi): (input: unknown) => HookResult {
  const call = api.registerHook.mock.calls[0];
  if (!call) throw new Error('hook not registered');
  return (call as unknown[])[2] as (input: unknown) => HookResult;
}

function setFilesystem(files: Record<string, string>) {
  mockFs = { '/project': { type: 'dir' } };
  for (const [path, content] of Object.entries(files)) {
    const normalized = normalizePath(path);
    let current = '/project';
    const parts = normalized.slice('/project/'.length).split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      current = `${current}/${parts[i]}`;
      if (!mockFs[current]) mockFs[current] = { type: 'dir' };
    }
    mockFs[normalized] = { type: 'file', content };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'cwd').mockReturnValue('/project');
  mockFs = { '/project': { type: 'dir' } };
});

afterEach(async () => {
  const api = makeApi();
  await plugin.teardown?.(api as never);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('duplicate-code-detector plugin shape', () => {
  it('has name, apiVersion, setup function', () => {
    expect(plugin.name).toBe('duplicate-code-detector');
    expect(plugin.apiVersion).toBe('^0.1.10');
    expect(plugin.version).toBe('0.1.0');
    expect(typeof plugin.setup).toBe('function');
  });

  it('registers two tools and a PostToolUse hook', () => {
    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    expect(api.tools.register).toHaveBeenCalledTimes(2);
    const names = api.tools.register.mock.calls.map(([t]: unknown[]) => (t as { name: string }).name);
    expect(names).toContain('detect_duplicate_code');
    expect(names).toContain('duplicate_code_status');
    const [event, matcher] = api.registerHook.mock.calls[0]!;
    expect(event).toBe('PostToolUse');
    expect(matcher).toBe('write|edit');
  });
});

describe('detect_duplicate_code tool', () => {
  it('finds identical blocks across two files', async () => {
    const block = `function sharedBlock() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = 4;\n  const e = 5;\n  const f = 6;\n  return a + b + c + d + e + f;\n}\n`;
    setFilesystem({
      '/project/src/a.ts': `${block}export const a = 1;\n`,
      '/project/src/b.ts': `${block}export const b = 2;\n`,
    });

    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const detect = getTool(api, 'detect_duplicate_code');
    const result = (await detect({ path: 'src' })) as {
      ok: boolean;
      findings: Array<{ locations: Array<{ file: string; startLine: number }> }>;
    };
    expect(result.ok).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]!.locations.length).toBe(2);
  });

  it('reports no duplicates for distinct files', async () => {
    setFilesystem({
      '/project/src/a.ts': 'export const a = 1;\n',
      '/project/src/b.ts': 'export const b = 2;\n',
    });

    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const detect = getTool(api, 'detect_duplicate_code');
    const result = (await detect({ path: 'src' })) as { ok: boolean; findings: unknown[] };
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('respects minLines config', async () => {
    setFilesystem({
      '/project/src/a.ts': 'const x = 1;\nconst y = 2;',
      '/project/src/b.ts': 'const x = 1;\nconst y = 2;',
    });

    const api = makeApi({
      extensions: { 'duplicate-code-detector': { enabled: true, minLines: 3 } },
    });
    plugin.setup(api as never);
    const detect = getTool(api, 'detect_duplicate_code');
    const result = (await detect({ path: 'src' })) as { ok: boolean; findings: unknown[] };
    expect(result.findings).toHaveLength(0);
  });

  it('caps findings at maxFindings', async () => {
    const block = `function sharedBlock() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = 4;\n  const e = 5;\n  const f = 6;\n  return a + b + c + d + e + f;\n}\n`;
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      files[`/project/src/f${i}.ts`] = `${block}export const v${i} = ${i};\n`;
    }
    setFilesystem(files);

    const api = makeApi({
      extensions: { 'duplicate-code-detector': { enabled: true, maxFindings: 2 } },
    });
    plugin.setup(api as never);
    const detect = getTool(api, 'detect_duplicate_code');
    const result = (await detect({ path: 'src' })) as { ok: boolean; findings: unknown[] };
    expect(result.ok).toBe(true);
    expect(result.findings.length).toBeLessThanOrEqual(2);
  });

  it('rejects paths outside the project root', async () => {
    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const detect = getTool(api, 'detect_duplicate_code');
    const outside = process.platform === 'win32' ? 'C:\\Windows\\evil.ts' : '/etc/evil.ts';
    const result = (await detect({ path: outside })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('outside');
  });

  it('enabled:false disables the scan tool', async () => {
    const api = makeApi({
      extensions: { 'duplicate-code-detector': { enabled: false } },
    });
    plugin.setup(api as never);
    const detect = getTool(api, 'detect_duplicate_code');
    const result = (await detect({})) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('disabled');
  });
});

describe('duplicate_code_status tool', () => {
  it('returns config and zero counters before any scan', async () => {
    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const status = getTool(api, 'duplicate_code_status');
    const result = (await status({})) as {
      ok: boolean;
      enabled: boolean;
      minLines: number;
      counters: Record<string, number>;
    };
    expect(result.ok).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.minLines).toBe(8);
    expect(result.counters['scans']).toBe(0);
  });

  it('reflects scan count after a detection run', async () => {
    const block = `function dup() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = 4;\n  const e = 5;\n  const f = 6;\n  return a + b + c + d + e + f;\n}\n`;
    setFilesystem({
      '/project/src/a.ts': `${block}`,
      '/project/src/b.ts': `${block}`,
    });

    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const detect = getTool(api, 'detect_duplicate_code');
    const status = getTool(api, 'duplicate_code_status');
    await detect({ path: 'src' });
    const result = (await status({})) as { ok: boolean; counters: Record<string, number> };
    expect(result.counters['scans']).toBe(1);
    expect(result.counters['findings']).toBeGreaterThan(0);
  });
});

describe('PostToolUse hook behavior', () => {
  it('warns when a write introduces a duplicated block', async () => {
    const block = `function sharedUtil() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = 4;\n  const e = 5;\n  const f = 6;\n  return a + b + c + d + e + f;\n}\n`;
    setFilesystem({
      '/project/src/original.ts': `${block}`,
      '/project/src/new.ts': `${block}`,
    });

    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const hook = getHook(api);
    const result = hook({
      toolName: 'write',
      toolInput: { path: 'src/new.ts', content: 'function sharedUtil() {\n  return 42;\n}' },
      toolResult: { content: 'ok', isError: false },
    });
    expect(result?.additionalContext).toContain('duplicate-code-detector');
    expect(result?.additionalContext).toContain('already present elsewhere');
  });

  it('stays silent when no duplication exists', async () => {
    setFilesystem({
      '/project/src/original.ts': 'function uniqueA() { return 1; }\n',
      '/project/src/new.ts': 'function uniqueB() { return 2; }\n',
    });

    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const hook = getHook(api);
    const result = hook({
      toolName: 'edit',
      toolInput: { path: 'src/new.ts', old_string: 'x', new_string: 'y' },
      toolResult: { content: 'ok', isError: false },
    });
    expect(result).toBeUndefined();
  });

  it('skips non-source files', async () => {
    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const hook = getHook(api);
    const result = hook({
      toolName: 'write',
      toolInput: { path: 'README.md', content: '# hello' },
      toolResult: { content: 'ok', isError: false },
    });
    expect(result).toBeUndefined();
  });

  it('skips when the mutating tool errored', async () => {
    setFilesystem({
      '/project/src/a.ts': 'function dup() {\n  return 1;\n}\n',
      '/project/src/b.ts': 'function dup() {\n  return 1;\n}\n',
    });

    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const hook = getHook(api);
    const result = hook({
      toolName: 'write',
      toolInput: { path: 'src/b.ts', content: 'x' },
      toolResult: { content: 'error', isError: true },
    });
    expect(result).toBeUndefined();
  });

  it('skips paths outside the project root', async () => {
    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    const hook = getHook(api);
    const result = hook({
      toolName: 'write',
      toolInput: { path: '/etc/evil.ts', content: 'x' },
      toolResult: { content: 'ok', isError: false },
    });
    expect(result).toBeUndefined();
  });
});

describe('teardown + counters', () => {
  it('logs completion and zeros counters', async () => {
    const api = makeApi({ enabled: true });
    plugin.setup(api as never);
    plugin.teardown!(api as never);
    expect(api.log.info).toHaveBeenCalledWith(
      'duplicate-code-detector: teardown complete',
      expect.any(Object),
    );
    const health = (await plugin.health!()) as { counters: Record<string, number> };
    expect(health.counters['scans']).toBe(0);
    expect(health.counters['findings']).toBe(0);
  });

  it('teardown is safe before setup', () => {
    const api = makeApi();
    expect(() => plugin.teardown!(api as never)).not.toThrow();
  });
});

describe('config parsing', () => {
  it('reads custom minLines and maxFindings', async () => {
    const api = makeApi({
      extensions: { 'duplicate-code-detector': { minLines: 3, maxFindings: 5 } },
    });
    plugin.setup(api as never);
    const status = getTool(api, 'duplicate_code_status');
    const result = (await status({})) as { minLines: number; maxFindings: number };
    expect(result.minLines).toBe(3);
    expect(result.maxFindings).toBe(5);
  });

  it('falls back to defaults for invalid values', async () => {
    const api = makeApi({
      extensions: { 'duplicate-code-detector': { minLines: -1, threshold: 5 } },
    });
    plugin.setup(api as never);
    const status = getTool(api, 'duplicate_code_status');
    const result = (await status({})) as { minLines: number; threshold: number };
    expect(result.minLines).toBe(8);
    expect(result.threshold).toBe(0.8);
  });
});
