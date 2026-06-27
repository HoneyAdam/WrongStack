import { describe, expect, it } from 'vitest';
import { HookRegistry, hookMatcherMatches } from '../../src/hooks/registry.js';
import { HookRunner } from '../../src/hooks/runner.js';
import { countShellHooks, shellHooksEqual } from '../../src/hooks/shell-hooks-equal.js';
import type { ShellHook } from '../../src/types/hooks.js';

const env = { cwd: '/work' };

describe('hookMatcherMatches', () => {
  it('matches "*" and empty against anything', () => {
    expect(hookMatcherMatches('*', 'bash')).toBe(true);
    expect(hookMatcherMatches('', 'bash')).toBe(true);
  });
  it('matches a pipe-delimited, case-insensitive tool list', () => {
    expect(hookMatcherMatches('Edit|Write', 'write')).toBe(true);
    expect(hookMatcherMatches('Edit|Write', 'bash')).toBe(false);
  });
  it('always matches when no tool name (non-tool events)', () => {
    expect(hookMatcherMatches('Bash', undefined)).toBe(true);
  });
});

describe('HookRunner.preToolUse', () => {
  it('blocks when a hook returns decision:block (first block wins)', async () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PreToolUse', 'Bash', () => ({ decision: 'block', reason: 'no shell' }));
    const runner = new HookRunner({ registry: reg });
    const r = await runner.preToolUse('bash', { command: 'ls' }, env);
    expect(r.block).toBe(true);
    expect(r.reason).toBe('no shell');
  });

  it('does not run hooks whose matcher excludes the tool', async () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PreToolUse', 'Edit', () => ({ decision: 'block' }));
    const runner = new HookRunner({ registry: reg });
    const r = await runner.preToolUse('bash', { command: 'ls' }, env);
    expect(r.block).toBeUndefined();
  });

  it('chains modifiedInput through successive hooks', async () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PreToolUse', '*', (i) => ({
      modifiedInput: { ...(i.toolInput as object), a: 1 },
    }));
    reg.registerInProcess('PreToolUse', '*', (i) => {
      // second hook sees the first hook's mutation
      expect((i.toolInput as { a?: number }).a).toBe(1);
      return { modifiedInput: { ...(i.toolInput as object), b: 2 } };
    });
    const runner = new HookRunner({ registry: reg });
    const r = await runner.preToolUse('bash', { command: 'ls' }, env);
    expect(r.input).toEqual({ command: 'ls', a: 1, b: 2 });
  });

  it('returns {} when nothing matches', async () => {
    const runner = new HookRunner({ registry: new HookRegistry() });
    expect(await runner.preToolUse('bash', {}, env)).toEqual({});
  });
});

describe('HookRunner.postToolUse', () => {
  it('merges additionalContext from all matching hooks', async () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PostToolUse', '*', () => ({ additionalContext: 'a' }));
    reg.registerInProcess('PostToolUse', '*', () => ({ additionalContext: 'b' }));
    const runner = new HookRunner({ registry: reg });
    const r = await runner.postToolUse('bash', {}, { content: 'out', isError: false }, env);
    expect(r.additionalContext).toBe('a\nb');
  });
});

describe('HookRunner.userPromptSubmit', () => {
  it('blocks and reports the reason', async () => {
    const reg = new HookRegistry();
    reg.registerInProcess('UserPromptSubmit', undefined, () => ({
      decision: 'block',
      reason: 'banned word',
    }));
    const runner = new HookRunner({ registry: reg });
    const r = await runner.userPromptSubmit('hello', env);
    expect(r.block).toBe(true);
    expect(r.reason).toBe('banned word');
  });

  it('injects additionalContext', async () => {
    const reg = new HookRegistry();
    reg.registerInProcess('UserPromptSubmit', undefined, () => ({ additionalContext: 'ctx' }));
    const runner = new HookRunner({ registry: reg });
    const r = await runner.userPromptSubmit('hello', env);
    expect(r.additionalContext).toBe('ctx');
  });
});

describe('HookRunner — failures and gating', () => {
  it('swallows hook exceptions (never throws into the loop)', async () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PreToolUse', '*', () => {
      throw new Error('boom');
    });
    const runner = new HookRunner({ registry: reg });
    await expect(runner.preToolUse('bash', {}, env)).resolves.toEqual({});
  });

  it('skips shell hooks when allowShell is false', async () => {
    const reg = new HookRegistry();
    reg.registerShell('PreToolUse', { command: 'exit 2' });
    const runner = new HookRunner({ registry: reg, allowShell: false });
    const r = await runner.preToolUse('bash', {}, env);
    expect(r.block).toBeUndefined();
  });
});

describe('HookRegistry — owner-scoped teardown', () => {
  it('tracks owner via registerInProcess', () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PreToolUse', '*', () => undefined, 'plugin-a');
    reg.registerInProcess('PreToolUse', '*', () => undefined, 'plugin-b');
    expect(reg.countByOwner('plugin-a')).toBe(1);
    expect(reg.countByOwner('plugin-b')).toBe(1);
    expect(reg.countByOwner('plugin-c')).toBe(0);
  });

  it('drainByOwner removes only the targeted plugin hooks', () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PreToolUse', '*', () => undefined, 'plugin-a');
    reg.registerInProcess('PostToolUse', '*', () => undefined, 'plugin-a');
    reg.registerInProcess('PreToolUse', '*', () => undefined, 'plugin-b');
    reg.registerShell('PreToolUse', { command: 'echo hi' });

    const removed = reg.drainByOwner('plugin-a');
    expect(removed).toBe(2);
    expect(reg.countByOwner('plugin-a')).toBe(0);
    expect(reg.countByOwner('plugin-b')).toBe(1);
    // Shell hooks survive drainByOwner — they're owned by the runtime.
    expect(reg.has('PreToolUse')).toBe(true);
  });

  it('drainByOwner returns 0 when nothing matches', () => {
    const reg = new HookRegistry();
    expect(reg.drainByOwner('nobody')).toBe(0);
  });

  it('per-call unsubscribe still works alongside drainByOwner', () => {
    const reg = new HookRegistry();
    const off = reg.registerInProcess('PreToolUse', '*', () => undefined, 'plugin-a');
    expect(reg.countByOwner('plugin-a')).toBe(1);
    off();
    expect(reg.countByOwner('plugin-a')).toBe(0);
    // Drain is a no-op on an already-empty owner.
    expect(reg.drainByOwner('plugin-a')).toBe(0);
  });

  it('all() returns a snapshot copy', () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PreToolUse', '*', () => undefined, 'a');
    reg.registerInProcess('PostToolUse', '*', () => undefined, 'b');
    const snap = reg.all();
    expect(snap).toHaveLength(2);
    // Mutating the returned array must not affect the registry.
    snap.length = 0;
    expect(reg.all()).toHaveLength(2);
  });

  it('list() filters by event and preserves registration order', () => {
    const reg = new HookRegistry();
    reg.registerInProcess('PreToolUse', 'Bash', () => undefined, 'x');
    reg.registerInProcess('PreToolUse', 'Edit', () => undefined, 'y');
    reg.registerInProcess('PostToolUse', '*', () => undefined, 'z');
    const pre = reg.list('PreToolUse');
    expect(pre).toHaveLength(2);
    expect((pre[0] as { owner?: string }).owner).toBe('x');
    expect((pre[1] as { owner?: string }).owner).toBe('y');
  });
});

describe('HookRegistry.replaceShellHooks', () => {
  it('drops the prior shell set and installs the new one', () => {
    const reg = new HookRegistry();
    reg.registerShell('PreToolUse', { command: 'echo old1' });
    reg.registerShell('PreToolUse', { command: 'echo old2' });
    expect(reg.list('PreToolUse')).toHaveLength(2);

    reg.replaceShellHooks({
      PreToolUse: [{ command: 'echo new' }],
      Stop: [{ command: 'echo bye' }],
    });
    expect(reg.list('PreToolUse')).toHaveLength(1);
    expect(reg.list('Stop')).toHaveLength(1);
  });

  it('preserves in-process hooks (plugin-owned entries are untouched)', () => {
    const reg = new HookRegistry();
    reg.registerShell('PreToolUse', { command: 'echo will-go' });
    const off = reg.registerInProcess('PreToolUse', '*', () => undefined, 'plugin-a');
    expect(reg.list('PreToolUse')).toHaveLength(2);

    reg.replaceShellHooks({ PreToolUse: [{ command: 'echo replaced' }] });
    const pre = reg.list('PreToolUse');
    expect(pre).toHaveLength(2);
    // Registration order is preserved: in-process (registered first) at 0,
    // the new shell entry appended at 1.
    expect((pre[0] as { kind: string }).kind).toBe('inprocess');
    expect((pre[0] as { owner?: string }).owner).toBe('plugin-a');
    expect((pre[1] as { kind: string }).kind).toBe('shell');
    expect(((pre[1] as { command?: string }).command)).toBe('echo replaced');
    // The plugin-owned unsubscribe is still valid — in-process entries
    // weren't touched.
    off();
    expect(reg.list('PreToolUse')).toHaveLength(1);
  });

  it('clears all shell entries when called with undefined', () => {
    const reg = new HookRegistry();
    reg.registerShell('PreToolUse', { command: 'echo a' });
    reg.registerShell('Stop', { command: 'echo b' });
    reg.replaceShellHooks(undefined);
    expect(reg.list('PreToolUse')).toHaveLength(0);
    expect(reg.list('Stop')).toHaveLength(0);
  });

  it('idempotent: calling twice with the same map yields the same state', () => {
    const reg = new HookRegistry();
    const map = { PreToolUse: [{ command: 'echo a' } as ShellHook], Stop: [{ command: 'echo b' } as ShellHook] };
    reg.replaceShellHooks(map);
    const first = reg.all().filter((e) => e.kind === 'shell').length;
    reg.replaceShellHooks(map);
    const second = reg.all().filter((e) => e.kind === 'shell').length;
    expect(first).toBe(second);
    expect(first).toBe(2);
  });
});

describe('shellHooksEqual', () => {
  const a = { PreToolUse: [{ command: 'echo x' }] };
  const aCopy = { PreToolUse: [{ command: 'echo x' }] };
  const aDiffCmd = { PreToolUse: [{ command: 'echo y' }] };
  const aDiffMatcher = { PreToolUse: [{ command: 'echo x', matcher: 'Bash' }] };
  const aDiffTimeout = { PreToolUse: [{ command: 'echo x', timeoutMs: 1000 }] };
  const aExtra = { PreToolUse: [{ command: 'echo x' }], Stop: [{ command: 'echo y' }] };
  const aReordered = { PreToolUse: [{ command: 'echo y' }, { command: 'echo x' }] };

  it('returns true for identical references', () => {
    expect(shellHooksEqual(a, a)).toBe(true);
  });

  it('treats undefined on either side as equivalent', () => {
    expect(shellHooksEqual(undefined, undefined)).toBe(true);
    expect(shellHooksEqual(a, undefined)).toBe(false);
    expect(shellHooksEqual(undefined, a)).toBe(false);
  });

  it('returns true for structurally-equal maps with separate object identity', () => {
    expect(shellHooksEqual(a, aCopy)).toBe(true);
  });

  it('detects command/matcher/timeoutMs differences', () => {
    expect(shellHooksEqual(a, aDiffCmd)).toBe(false);
    expect(shellHooksEqual(a, aDiffMatcher)).toBe(false);
    expect(shellHooksEqual(a, aDiffTimeout)).toBe(false);
  });

  it('detects added/removed events', () => {
    expect(shellHooksEqual(a, aExtra)).toBe(false);
  });

  it('treats different order within an event as a difference (order matters)', () => {
    expect(shellHooksEqual(a, aReordered)).toBe(false);
  });
});

describe('countShellHooks', () => {
  it('returns 0 for undefined', () => {
    expect(countShellHooks(undefined)).toBe(0);
  });
  it('counts entries across all events', () => {
    expect(
      countShellHooks({
        PreToolUse: [{ command: 'a' }, { command: 'b' }],
        Stop: [{ command: 'c' }],
      }),
    ).toBe(3);
  });
  it('skips undefined event arrays', () => {
    expect(
      countShellHooks({
        PreToolUse: undefined as never,
        Stop: [{ command: 'c' }],
      }),
    ).toBe(1);
  });
});
