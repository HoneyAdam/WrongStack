import { describe, expect, it, vi } from 'vitest';
import {
  buildSaveCommand,
  buildLoadCommand,
  buildExitCommand,
} from '../src/slash-commands/session.js';

function fakeCtx() {
  return {
    session: {
      id: 'sess-1',
      append: vi.fn().mockResolvedValue(undefined),
    },
  } as never;
}

// ── /save ────────────────────────────────────────────────────────────────────

describe('buildSaveCommand', () => {
  it('appends a session_end event and reports flushed', async () => {
    const ctx = fakeCtx();
    const cmd = buildSaveCommand({
      tokenCounter: { total: () => ({ input: 100, output: 50 }) },
    } as never);
    const res = await cmd.run('', ctx);
    expect(res?.message).toContain('sess-1 flushed');
    expect(ctx.session.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session_end', usage: { input: 100, output: 50 } }),
    );
  });
});

// ── /resume (load) ───────────────────────────────────────────────────────────

describe('buildLoadCommand', () => {
  it('exposes name "resume" with aliases', () => {
    const cmd = buildLoadCommand({} as never);
    expect(cmd.name).toBe('resume');
    expect(cmd.aliases).toEqual(expect.arrayContaining(['load', 'sessions']));
  });

  it('returns "no session store" when undefined', async () => {
    const cmd = buildLoadCommand({} as never);
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('No session store');
  });

  it('returns "no saved sessions" when list is empty', async () => {
    const cmd = buildLoadCommand({
      sessionStore: { list: vi.fn().mockResolvedValue([]) },
    } as never);
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('No saved sessions');
  });

  it('renders a list and also writes to renderer', async () => {
    const write = vi.fn();
    const cmd = buildLoadCommand({
      sessionStore: {
        list: vi.fn().mockResolvedValue([
          { id: 'a', startedAt: '2026-01-01', tokenTotal: 5000, title: 'first task' },
          { id: 'b', startedAt: '2026-02-01', tokenTotal: 12000, title: 'second task' },
        ]),
      },
      renderer: { write },
    } as never);
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('Recent sessions');
    expect(res?.message).toContain('first task');
    expect(res?.message).toContain('second task');
    expect(res?.message).toContain('Resume one with: wstack resume a');
    expect(write).toHaveBeenCalled();
  });
});

// ── /exit ────────────────────────────────────────────────────────────────────

describe('buildExitCommand', () => {
  it('returns { exit: true } when no pre-exit handler set', async () => {
    const onExit = vi.fn();
    const cmd = buildExitCommand({ onExit } as never);
    const res = await cmd.run('', fakeCtx());
    expect(res?.exit).toBe(true);
    expect(onExit).toHaveBeenCalled();
  });

  it('runs onBeforeExit; aborts when handler signals abort', async () => {
    const onBeforeExit = vi.fn().mockResolvedValue({ abort: true, message: 'uncommitted changes' });
    const onExit = vi.fn();
    const cmd = buildExitCommand({ onBeforeExit, onExit } as never);
    const res = await cmd.run('', fakeCtx());
    expect(res?.exit).toBe(true);
    expect(res?.message).toBe('uncommitted changes');
    expect(onExit).toHaveBeenCalled();
  });

  it('still exits when onBeforeExit resolves without abort', async () => {
    const onBeforeExit = vi.fn().mockResolvedValue(undefined);
    const onExit = vi.fn();
    const cmd = buildExitCommand({ onBeforeExit, onExit } as never);
    const res = await cmd.run('', fakeCtx());
    expect(res?.exit).toBe(true);
    expect(onExit).toHaveBeenCalled();
  });

  it('returns exit even when no onExit registered', async () => {
    const cmd = buildExitCommand({} as never);
    const res = await cmd.run('', fakeCtx());
    expect(res?.exit).toBe(true);
  });
});
