import { describe, expect, it, vi } from 'vitest';
import { buildContextCommand } from '../src/slash-commands/context.js';

function fakeRenderer() {
  const writes: string[] = [];
  return {
    writes,
    write: (s: string) => {
      writes.push(s);
    },
  };
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
  const messages: unknown[] = [];
  const todos: unknown[] = [];
  return {
    messages,
    todos,
    readFiles: new Set<string>(),
    fileMtimes: new Map<string, number>(),
    systemPrompt: [{ type: 'text', text: 'sys' }],
    model: 'opus',
    cwd: '/wd',
    projectRoot: '/wd',
    meta: {} as Record<string, unknown>,
    state: {
      replaceMessages: vi.fn((m: unknown[]) => {
        messages.splice(0, messages.length, ...m);
      }),
    },
    ...overrides,
  } as never;
}

describe('buildContextCommand', () => {
  it('default invocation prints the context summary', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const ctx = fakeCtx();
    const res = await cmd.run('', ctx);
    expect(res?.message).toContain('Context Window');
    expect(res?.message).toContain('messages:');
    expect(res?.message).toContain('mode:');
    expect(renderer.writes.length).toBeGreaterThan(0);
  });

  it('"detail" adds model/cwd/projectRoot/mtimes/file list when files present', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const ctx = fakeCtx();
    ctx.readFiles.add('/a/b.ts');
    ctx.fileMtimes.set('/a/b.ts', 1);
    const res = await cmd.run('detail', ctx);
    expect(res?.message).toContain('model:');
    expect(res?.message).toContain('cwd:');
    expect(res?.message).toContain('projectRoot:');
    expect(res?.message).toContain('file mtimes:');
    expect(res?.message).toContain('file list:');
    expect(res?.message).toContain('/a/b.ts');
  });

  it('"mode" lists all context modes', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const ctx = fakeCtx();
    const res = await cmd.run('mode', ctx);
    expect(res?.message).toContain('Context Window Modes');
  });

  it('"modes" alias also lists modes', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const res = await cmd.run('modes', fakeCtx());
    expect(res?.message).toContain('Context Window Modes');
  });

  it('"mode <unknown>" reports unknown mode', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const res = await cmd.run('mode bogus-mode', fakeCtx());
    expect(res?.message).toContain('Unknown context mode');
  });

  it('"mode <valid>" switches the context window mode and stores policy on meta', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const ctx = fakeCtx();
    const res = await cmd.run('mode balanced', ctx);
    expect(res?.message).toContain('Context mode set');
    expect(ctx.meta['contextWindowMode']).toBe('balanced');
    expect(ctx.meta['contextWindowPolicy']).toBeDefined();
  });

  it('readPolicy round-trips: after `mode <id>`, default summary shows that mode name', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const ctx = fakeCtx();
    await cmd.run('mode frugal', ctx);
    const res = await cmd.run('', ctx);
    expect(res?.message).toContain('frugal');
  });

  it('"repair" reports no orphans when messages are well-formed', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const ctx = fakeCtx({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ],
    });
    const res = await cmd.run('repair', ctx);
    expect(res?.message).toContain('no orphan');
  });

  it('"repair" reports counts when an orphan tool_use is removed', async () => {
    const renderer = fakeRenderer();
    const cmd = buildContextCommand({ renderer } as never);
    const ctx = fakeCtx({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'going' },
            { type: 'tool_use', id: 't1', name: 'read', input: {} },
          ],
        },
      ],
    });
    const res = await cmd.run('repair', ctx);
    expect(res?.message).toContain('Context repaired');
    expect(res?.message).toContain('tool_use');
    expect(ctx.state.replaceMessages).toHaveBeenCalled();
  });
});
