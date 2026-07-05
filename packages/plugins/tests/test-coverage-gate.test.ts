import { beforeEach, describe, expect, it, vi } from 'vitest';

const coverageGatePlugin = (await import('../src/test-coverage-gate')).default;

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

type HookResult = { decision?: string; reason?: string; additionalContext?: string } | undefined;

function getHook(api: MockApi): (input: unknown) => HookResult {
  const call = api.registerHook.mock.calls[0];
  if (!call) throw new Error('hook not registered');
  return (call as unknown[])[2] as (input: unknown) => HookResult;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('test-coverage-gate plugin', () => {
  it('registers coverage_gate_status and a PostToolUse write|edit hook', async () => {
    const api = makeApi();
    coverageGatePlugin.setup(api as never);
    expect(api.tools.register).toHaveBeenCalledTimes(1);
    const [event, matcher] = api.registerHook.mock.calls[0]!;
    expect(event).toBe('PostToolUse');
    expect(matcher).toBe('write|edit');
  });

  it('skips files outside the project', async () => {
    const api = makeApi();
    coverageGatePlugin.setup(api as never);
    const hook = getHook(api);
    const result = await hook({
      toolName: 'write',
      toolInput: { path: '/etc/passwd' },
      toolResult: { content: '', isError: false },
    });
    expect(result).toBeUndefined();
  });

  it('enabled:false disables the hook', async () => {
    const api = makeApi({ extensions: { 'test-coverage-gate': { enabled: false } } });
    coverageGatePlugin.setup(api as never);
    const hook = getHook(api);
    const result = await hook({
      toolName: 'edit',
      toolInput: { path: 'src/foo.ts' },
      toolResult: { content: '', isError: false },
    });
    expect(result).toBeUndefined();
  });

  it('teardown zeros state and logs', async () => {
    const api = makeApi();
    coverageGatePlugin.setup(api as never);
    coverageGatePlugin.teardown!(api as never);
    const health = (await coverageGatePlugin.health!()) as { counters: Record<string, number> };
    expect(health.counters['runs']).toBe(0);
    expect(api.log.info).toHaveBeenCalledWith(
      'test-coverage-gate: teardown complete',
      expect.any(Object),
    );
  });
});
