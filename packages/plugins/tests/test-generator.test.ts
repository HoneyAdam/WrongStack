import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Virtual filesystem mock
// ---------------------------------------------------------------------------

type FsEntry = { type: 'file'; content: string } | { type: 'dir' };

let mockFs: Record<string, FsEntry> = {};

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function mockReadFileSync(p: string, encoding?: string) {
  const normalized = normalizePath(p);
  const entry = mockFs[normalized];
  if (!entry || entry.type !== 'file') {
    const err = new Error(`ENOENT: ${normalized}`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }
  if (encoding === 'utf-8' || encoding === 'utf8') return entry.content;
  return Buffer.from(entry.content);
}

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(mockReadFileSync),
}));

const plugin = (await import('../src/test-generator')).default;

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

function makeApi(overrides: { extensions?: Record<string, unknown> } = {}): MockApi {
  return {
    tools: { register: vi.fn() },
    config: { extensions: overrides.extensions ?? {} },
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

describe('test-generator plugin shape', () => {
  it('has name, apiVersion, setup function', () => {
    expect(plugin.name).toBe('test-generator');
    expect(plugin.apiVersion).toBe('^0.1.10');
    expect(plugin.version).toBe('0.1.0');
    expect(typeof plugin.setup).toBe('function');
  });

  it('registers generate_unit_tests tool and no hook', () => {
    const api = makeApi();
    plugin.setup(api as never);
    expect(api.tools.register).toHaveBeenCalledTimes(1);
    const names = api.tools.register.mock.calls.map(([t]: unknown[]) => (t as { name: string }).name);
    expect(names).toContain('generate_unit_tests');
    expect(api.registerHook).not.toHaveBeenCalled();
  });
});

describe('generate_unit_tests tool', () => {
  it('generates tests for exported functions, arrows, and classes', async () => {
    setFilesystem({
      '/project/src/math.ts':
        'export function add(a: number, b: number) { return a + b; }\n' +
        'export const sub = (a: number, b: number) => a - b;\n' +
        'export class Calculator {}\n' +
        'export { add as addAlias };\n',
    });

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_unit_tests');
    const result = (await generate({ path: 'src/math.ts' })) as {
      ok: boolean;
      testFile: string;
      exports: Array<{ name: string; kind: string }>;
      content: string;
    };
    expect(result.ok).toBe(true);
    expect(result.testFile).toBe('math.test.ts');
    expect(result.exports.map((e) => e.name)).toContain('add');
    expect(result.exports.map((e) => e.name)).toContain('sub');
    expect(result.exports.map((e) => e.name)).toContain('Calculator');
    expect(result.content).toContain("import { describe, it, expect } from 'vitest';");
    expect(result.content).toContain("it('add behaves as expected'");
    expect(result.content).toContain("new Calculator()");
  });

  it('generates a placeholder when no exports are found', async () => {
    setFilesystem({
      '/project/src/empty.ts': 'const hidden = 1;\n',
    });

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_unit_tests');
    const result = (await generate({ path: 'src/empty.ts' })) as {
      ok: boolean;
      exports: unknown[];
      content: string;
    };
    expect(result.ok).toBe(true);
    expect(result.exports).toHaveLength(0);
    expect(result.content).toContain('has no exported symbols to test');
  });

  it('respects framework and testSuffix config', async () => {
    setFilesystem({
      '/project/src/util.ts': 'export function foo() { return 1; }\n',
    });

    const api = makeApi({
      extensions: { 'test-generator': { framework: 'node:test', testSuffix: '.spec' } },
    });
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_unit_tests');
    const result = (await generate({ path: 'src/util.ts' })) as {
      ok: boolean;
      testFile: string;
      content: string;
    };
    expect(result.testFile).toBe('util.spec.ts');
    expect(result.content).toContain("require('node:test')");
  });

  it('omits imports when includeImports is false', async () => {
    setFilesystem({
      '/project/src/util.ts': 'export function foo() { return 1; }\n',
    });

    const api = makeApi({
      extensions: { 'test-generator': { includeImports: false } },
    });
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_unit_tests');
    const result = (await generate({ path: 'src/util.ts' })) as { ok: boolean; content: string };
    expect(result.content).not.toContain("import { foo } from './util';");
  });

  it('rejects paths outside the project root', async () => {
    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_unit_tests');
    const outside = process.platform === 'win32' ? 'C:\\Windows\\evil.ts' : '/etc/evil.ts';
    const result = (await generate({ path: outside })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('outside');
  });

  it('enabled:false disables the tool', async () => {
    const api = makeApi({ extensions: { 'test-generator': { enabled: false } } });
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_unit_tests');
    const result = (await generate({ path: 'src/x.ts' })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('disabled');
  });
});

describe('teardown + counters', () => {
  it('logs completion and zeros counters', async () => {
    setFilesystem({ '/project/src/a.ts': 'export const a = 1;\n' });
    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_unit_tests');
    await generate({ path: 'src/a.ts' });
    plugin.teardown!(api as never);
    expect(api.log.info).toHaveBeenCalledWith('test-generator: teardown complete', expect.any(Object));
    const health = (await plugin.health!()) as { counters: Record<string, number> };
    expect(health.counters['generated']).toBe(0);
    expect(health.counters['exports']).toBe(0);
  });

  it('teardown is safe before setup', () => {
    const api = makeApi();
    expect(() => plugin.teardown!(api as never)).not.toThrow();
  });
});

describe('config parsing', () => {
  it('reads custom framework and suffix', async () => {
    const api = makeApi({
      extensions: { 'test-generator': { framework: 'jest', testSuffix: '.integration' } },
    });
    plugin.setup(api as never);
    setFilesystem({ '/project/src/x.ts': 'export function x() {}\n' });
    const generate = getTool(api, 'generate_unit_tests');
    const result = (await generate({ path: 'src/x.ts' })) as { ok: boolean; testFile: string; content: string };
    expect(result.testFile).toBe('x.integration.ts');
    expect(result.content).toContain("require('jest')");
  });
});
