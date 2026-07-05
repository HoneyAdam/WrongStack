import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const { existsSync, readFileSync } = await import('node:fs');
const migrationPlannerPlugin = (await import('../src/migration-planner')).default;

interface MockApi {
  tools: { register: ReturnType<typeof vi.fn> };
  config: { extensions: Record<string, unknown> };
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  metrics: {
    counter: ReturnType<typeof vi.fn>;
  };
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
  const call = api.tools.register.mock.calls.find((c) => (c[0] as { name: string }).name === name);
  if (!call) throw new Error(`tool ${name} not registered`);
  return (call[0] as { execute: (input: unknown) => Promise<unknown> }).execute;
}

function getHook(api: MockApi): (input: unknown) => unknown {
  const call = api.registerHook.mock.calls[0];
  if (!call) throw new Error('hook not registered');
  return (call as unknown[])[2] as (input: unknown) => unknown;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReset();
  vi.mocked(readFileSync).mockReset();
});

afterEach(async () => {
  const api = makeApi();
  await migrationPlannerPlugin.teardown?.(api as never);
});

describe('migration-planner plugin', () => {
  it('registers migration_plan, migration_status, and a PostToolUse hook', () => {
    const api = makeApi();
    migrationPlannerPlugin.setup(api as never);
    expect(api.tools.register).toHaveBeenCalledTimes(2);
    const names = api.tools.register.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names).toContain('migration_plan');
    expect(names).toContain('migration_status');
    const [event, matcher] = api.registerHook.mock.calls[0]!;
    expect(event).toBe('PostToolUse');
    expect(matcher).toBe('write|edit');
  });

  it('parses a changelog and extracts breaking changes between versions', async () => {
    vi.mocked(existsSync).mockImplementation(
      (p) => String(p) === 'node_modules/my-pkg/CHANGELOG.md',
    );
    vi.mocked(readFileSync).mockReturnValue(`
# Changelog

## [2.0.0] - 2024-01-01

### BREAKING CHANGES
- Removed legacy API \`foo()\`
- Dropped Node 16 support

### Migration
- Replace \`foo()\` with \`bar()\`
- Upgrade to Node 18

## [1.5.0] - 2023-06-01

### Added
- New helper \`baz()\`

## [1.0.0] - 2023-01-01

### BREAKING CHANGES
- Initial stable release
`);

    const api = makeApi();
    migrationPlannerPlugin.setup(api as never);
    const plan = getTool(api, 'migration_plan');
    const result = (await plan({
      packageName: 'my-pkg',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    })) as {
      ok: boolean;
      fallback: boolean;
      breakingChanges: string[];
      recommendedSteps: string[];
      changelogSource: string | null;
    };

    expect(result.ok).toBe(true);
    expect(result.fallback).toBe(false);
    expect(result.changelogSource).toBe('node_modules/my-pkg/CHANGELOG.md');
    expect(result.breakingChanges).toContain('Removed legacy API `foo()`');
    expect(result.breakingChanges).toContain('Dropped Node 16 support');
    expect(result.recommendedSteps).toContain('Replace `foo()` with `bar()`');
    expect(result.recommendedSteps).toContain('Upgrade to Node 18');
  });

  it('returns a generic guide when no changelog exists', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const api = makeApi();
    migrationPlannerPlugin.setup(api as never);
    const plan = getTool(api, 'migration_plan');
    const result = (await plan({
      packageName: 'unknown-pkg',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    })) as {
      ok: boolean;
      fallback: boolean;
      breakingChanges: string[];
      recommendedSteps: string[];
      changelogSource: string | null;
    };

    expect(result.ok).toBe(true);
    expect(result.fallback).toBe(true);
    expect(result.changelogSource).toBeNull();
    expect(result.breakingChanges.some((b) => b.includes('No changelog found'))).toBe(true);
    expect(result.recommendedSteps.length).toBeGreaterThan(0);
  });

  it('migration_status reports counters', async () => {
    const api = makeApi();
    migrationPlannerPlugin.setup(api as never);
    const plan = getTool(api, 'migration_plan');
    const status = getTool(api, 'migration_status');

    await plan({ packageName: 'x', fromVersion: '1.0.0', toVersion: '2.0.0' });
    const result = (await status({})) as { ok: boolean; counters: Record<string, number> };

    expect(result.ok).toBe(true);
    expect(result.counters.plansGenerated).toBe(1);
    expect(result.counters.statusQueries).toBe(1);
  });

  it('enabled:false disables migration_plan', async () => {
    const api = makeApi({ extensions: { 'migration-planner': { enabled: false } } });
    migrationPlannerPlugin.setup(api as never);
    const plan = getTool(api, 'migration_plan');
    const result = (await plan({
      packageName: 'x',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
  });

  it('PostToolUse hook reminds about migration planning on package.json edits', async () => {
    const api = makeApi();
    migrationPlannerPlugin.setup(api as never);
    const hook = getHook(api);
    const result = (await hook({
      toolName: 'write',
      toolInput: { path: 'package.json' },
      toolResult: { content: '', isError: false },
    })) as { additionalContext?: string } | undefined;
    expect(result?.additionalContext).toContain('migration_plan');
  });

  it('teardown zeros state and logs', async () => {
    const api = makeApi();
    migrationPlannerPlugin.setup(api as never);
    migrationPlannerPlugin.teardown!(api as never);
    const health = (await migrationPlannerPlugin.health!()) as {
      counters: Record<string, number>;
    };
    expect(health.counters.plansGenerated).toBe(0);
    expect(api.log.info).toHaveBeenCalledWith(
      'migration-planner: teardown complete',
      expect.any(Object),
    );
  });
});
