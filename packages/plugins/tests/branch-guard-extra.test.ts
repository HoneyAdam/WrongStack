/**
 * Additional tests for branch-guard plugin - covering catch blocks
 * and shouldBlock fallthrough.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Async execFile mock - can be configured to fail specific commands.
let statusShouldThrow = false;
let allShouldThrow = false;
const mockExecFile = vi.fn(
  (
    _cmd: string,
    args: string[],
    _opts: unknown,
    cb: (error: Error | null, stdout: string) => void,
  ) => {
    const command = args.join(' ');
    const error =
      allShouldThrow || (statusShouldThrow && command.includes('status --porcelain'))
        ? new Error('git failed')
        : null;
    const stdout = command.includes('branch --show-current') ? 'main\n' : '';
    queueMicrotask(() => cb(error, error ? '' : stdout));
  },
);

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

const branchGuardPlugin = (await import('../src/branch-guard')).default;

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
    histogram: ReturnType<typeof vi.fn>;
    gauge: ReturnType<typeof vi.fn>;
  };
  registerHook: ReturnType<typeof vi.fn>;
  onConfigChange: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
  emitCustom: ReturnType<typeof vi.fn>;
  session: { append: ReturnType<typeof vi.fn> };
}

function makeApi(overrides: { extensions?: Record<string, unknown> } = {}): MockApi {
  return {
    tools: { register: vi.fn() },
    config: { extensions: overrides.extensions ?? {} },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    metrics: { counter: vi.fn(), histogram: vi.fn(), gauge: vi.fn() },
    registerHook: vi.fn(() => vi.fn()),
    onConfigChange: vi.fn(() => vi.fn()),
    onEvent: vi.fn(),
    emitCustom: vi.fn(),
    session: { append: vi.fn().mockResolvedValue(undefined) },
  };
}

function getHook(api: MockApi): (input: unknown) => Promise<unknown> {
  const call = api.registerHook.mock.calls[0];
  if (!call) throw new Error('hook not registered');
  return (call as unknown[])[2] as ReturnType<typeof getHook>;
}

beforeEach(() => {
  vi.clearAllMocks();
  statusShouldThrow = false;
  allShouldThrow = false;
});

describe('branch-guard - git failure paths', () => {
  it('handles git branch detection failure gracefully', async () => {
    allShouldThrow = true;
    const api = makeApi({ extensions: { 'branch-guard': { mode: 'off' } } });
    branchGuardPlugin.setup(api as never);
    const hook = getHook(api);
    // When git fails, shouldBlock returns false -> hook returns undefined
    expect(
      await hook({ toolName: 'bash', toolInput: { command: 'git commit -m "x"' } }),
    ).toBeUndefined();
  });

  it('handles git status failure gracefully (status throws)', async () => {
    statusShouldThrow = true;
    const api = makeApi(); // mode=block by default
    branchGuardPlugin.setup(api as never);
    const hook = getHook(api) as (input: unknown) => Promise<{ decision?: string } | void>;
    // Trigger with a git commit command - status failure should not crash
    const result = await hook({ toolName: 'bash', toolInput: { command: 'git commit -m "test"' } });
    // When status throws, no stash suggestion but still blocks
    expect(result?.decision).toBe('block');
    statusShouldThrow = false;
  });

  it('allows non-commit/push/merge git operations on protected branch', async () => {
    const api = makeApi();
    branchGuardPlugin.setup(api as never);
    const hook = getHook(api) as (input: unknown) => Promise<{ decision?: string } | void>;
    // 'git log' is a read-only git operation that is not commit/push/merge
    const result = await hook({ toolName: 'bash', toolInput: { command: 'git log --oneline' } });
    expect(result).toBeUndefined();
  });

  it('allows rebase on protected branch (when blockRebase not set)', async () => {
    const api = makeApi();
    branchGuardPlugin.setup(api as never);
    const hook = getHook(api) as (input: unknown) => Promise<{ decision?: string } | void>;
    // 'git rebase' is not commit/push/merge - shouldBlock returns false
    const result = await hook({ toolName: 'bash', toolInput: { command: 'git rebase main' } });
    expect(result).toBeUndefined();
  });
});
