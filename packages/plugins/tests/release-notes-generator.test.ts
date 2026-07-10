import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocked child_process
// ---------------------------------------------------------------------------

let mockGitOutput = '';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((_file: string, args: string[]) => {
    if (args[0] === 'describe') return 'v1.0.0\n';
    if (args[0] === 'rev-parse') {
      const ref = args.at(-1) ?? '';
      return ref.startsWith('HEAD') || ref.startsWith('--help')
        ? `${'b'.repeat(40)}\n`
        : `${'a'.repeat(40)}\n`;
    }
    return mockGitOutput;
  }),
}));

const plugin = (await import('../src/release-notes-generator')).default;

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

beforeEach(() => {
  vi.clearAllMocks();
  mockGitOutput = '';
});

afterEach(async () => {
  const api = makeApi();
  await plugin.teardown?.(api as never);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('release-notes-generator plugin shape', () => {
  it('has name, apiVersion, setup function', () => {
    expect(plugin.name).toBe('release-notes-generator');
    expect(plugin.apiVersion).toBe('^0.1.10');
    expect(plugin.version).toBe('0.1.0');
    expect(typeof plugin.setup).toBe('function');
  });

  it('registers generate_release_notes tool and no hook', () => {
    const api = makeApi();
    plugin.setup(api as never);
    expect(api.tools.register).toHaveBeenCalledTimes(1);
    const names = api.tools.register.mock.calls.map(([t]: unknown[]) => (t as { name: string }).name);
    expect(names).toContain('generate_release_notes');
    expect(api.registerHook).not.toHaveBeenCalled();
  });
});

describe('generate_release_notes tool', () => {
  it('groups conventional commits by type', async () => {
    mockGitOutput = [
      'aaa111\tfeat(auth): add login',
      'bbb222\tfix(api): handle null',
      'ccc333\tdocs: update readme',
      'ddd444\tchore: bump deps',
    ].join('\n');

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({ from: 'v1.0.0', to: 'HEAD' })) as {
      ok: boolean;
      notes: string;
      commitCount: number;
    };
    expect(result.ok).toBe(true);
    expect(result.commitCount).toBe(4);
    expect(result.notes).toContain('### feat');
    expect(result.notes).toContain('### fix');
    expect(result.notes).toContain('### docs');
    expect(result.notes).toContain('add login');
    expect(result.notes).toContain('[auth]');
  });

  it('puts non-conventional commits in Uncategorized', async () => {
    mockGitOutput = ['aaa111\twip: random thing', 'bbb222\tfeat: real feature'].join('\n');

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({ from: 'v0.9.0', to: 'HEAD' })) as {
      ok: boolean;
      notes: string;
    };
    expect(result.ok).toBe(true);
    expect(result.notes).toContain('### Uncategorized');
    expect(result.notes).toContain('random thing');
  });

  it('omits scopes when includeScope is false', async () => {
    mockGitOutput = 'aaa111\tfeat(auth): add login\n';

    const api = makeApi({
      extensions: { 'release-notes-generator': { includeScope: false } },
    });
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({ from: 'v0.9.0', to: 'HEAD' })) as {
      ok: boolean;
      notes: string;
    };
    expect(result.ok).toBe(true);
    expect(result.notes).toContain('add login');
    expect(result.notes).not.toContain('[auth]');
  });

  it('defaults from to latest tag when not provided', async () => {
    mockGitOutput = 'aaa111\tfeat: default from tag\n';

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({ to: 'HEAD' })) as { ok: boolean; from: string | null };
    expect(result.ok).toBe(true);
    expect(result.from).toBe('v1.0.0');
  });

  it('returns empty notes when no commits are found', async () => {
    mockGitOutput = '';

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({ from: 'v1.0.0', to: 'HEAD' })) as {
      ok: boolean;
      notes: string;
      commitCount: number;
    };
    expect(result.ok).toBe(true);
    expect(result.commitCount).toBe(0);
    expect(result.notes).toContain('No commits found');
  });

  it('passes malicious-looking refs as inert argv and logs only resolved commit ids', async () => {
    const { execFileSync } = await import('node:child_process');
    const from = 'v1.0.0; echo injected';
    const to = '--help && calc.exe';

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({ from, to })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['rev-parse', '--verify', '--end-of-options', `${to}^{commit}`],
      expect.objectContaining({ shell: false }),
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      'git',
      ['rev-parse', '--verify', '--end-of-options', `${from}^{commit}`],
      expect.objectContaining({ shell: false }),
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      3,
      'git',
      [
        'log',
        '--pretty=format:%H%x09%s',
        '--end-of-options',
        `${'a'.repeat(40)}..${'b'.repeat(40)}`,
      ],
      expect.objectContaining({ shell: false }),
    );
  });

  it('rejects malformed output from revision resolution before git log runs', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValueOnce('not-a-commit\n');

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({ from: 'v1', to: 'HEAD' })) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid commit id');
    expect(vi.mocked(execFileSync).mock.calls).toHaveLength(1);
  });

  it('enabled:false disables the tool', async () => {
    const api = makeApi({ extensions: { 'release-notes-generator': { enabled: false } } });
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({})) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('surfaces git errors gracefully', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('git exploded');
    });

    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    const result = (await generate({ from: 'bad-ref', to: 'HEAD' })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('git exploded');
  });
});

describe('teardown + counters', () => {
  it('logs completion and zeros counters', async () => {
    mockGitOutput = 'aaa111\tfeat: x\n';
    const api = makeApi();
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    await generate({ from: 'v0.9.0', to: 'HEAD' });
    plugin.teardown!(api as never);
    expect(api.log.info).toHaveBeenCalledWith(
      'release-notes-generator: teardown complete',
      expect.any(Object),
    );
    const health = (await plugin.health!()) as { counters: Record<string, number> };
    expect(health.counters['generated']).toBe(0);
    expect(health.counters['commits']).toBe(0);
  });

  it('teardown is safe before setup', () => {
    const api = makeApi();
    expect(() => plugin.teardown!(api as never)).not.toThrow();
  });
});

describe('config parsing', () => {
  it('reads includeScope and defaultFrom', async () => {
    const api = makeApi({
      extensions: { 'release-notes-generator': { includeScope: false, defaultFrom: 'origin/main' } },
    });
    plugin.setup(api as never);
    const generate = getTool(api, 'generate_release_notes');
    mockGitOutput = 'aaa111\tfeat(scope): x\n';
    const result = (await generate({ to: 'HEAD' })) as { ok: boolean; from: string | null; notes: string };
    expect(result.from).toBe('origin/main');
    expect(result.notes).not.toContain('[scope]');
  });
});
