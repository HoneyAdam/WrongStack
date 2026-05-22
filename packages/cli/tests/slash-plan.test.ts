import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildPlanCommand } from '../src/slash-commands/plan.js';
import type { SlashCommandContext } from '../src/slash-commands/index.js';

let tmp: string;
let planPath: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-slash-'));
  planPath = path.join(tmp, 'plan.json');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<SlashCommandContext> & { planPath?: string } = {}) {
  const ctxState = {
    todos: [] as Array<{ id: string; content: string; status: string }>,
    replaceTodos(next: typeof ctxState.todos) {
      this.todos.splice(0, this.todos.length, ...next);
    },
  };
  return {
    config: {} as never,
    container: {} as never,
    context: {
      session: { id: 'sess-x' },
      state: {
        replaceTodos: vi.fn((t) => ctxState.replaceTodos(t)),
      },
    } as never,
    planPath,
    ...overrides,
  } as SlashCommandContext & { planPath?: string };
}

describe('buildPlanCommand', () => {
  it('reports when planPath missing', async () => {
    const cmd = buildPlanCommand(makeCtx({ planPath: undefined }));
    const res = await cmd.run('show');
    expect(res.message).toContain('not configured');
  });

  it('show on empty plan renders empty state', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('');
    expect(typeof res.message).toBe('string');
  });

  it('add without args returns usage', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('add');
    expect(res.message).toContain('Usage:');
  });

  it('add inserts an item and persists', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('add Investigate timeout bug');
    expect(res.message).toContain('Investigate timeout bug');
    const persisted = JSON.parse(await fs.readFile(planPath, 'utf8'));
    expect(persisted.items).toHaveLength(1);
  });

  it('start without arg returns usage', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('start');
    expect(res.message).toContain('Usage:');
  });

  it('start by 1-based index sets in_progress', async () => {
    const cmd = buildPlanCommand(makeCtx());
    await cmd.run('add One thing');
    await cmd.run('start 1');
    const stored = JSON.parse(await fs.readFile(planPath, 'utf8'));
    expect(stored.items[0].status).toBe('in_progress');
  });

  it('done by 1-based index sets done', async () => {
    const cmd = buildPlanCommand(makeCtx());
    await cmd.run('add One thing');
    await cmd.run('done 1');
    const stored = JSON.parse(await fs.readFile(planPath, 'utf8'));
    expect(stored.items[0].status).toBe('done');
  });

  it('remove without arg returns usage', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('rm');
    expect(res.message).toContain('Usage:');
  });

  it('remove drops the item', async () => {
    const cmd = buildPlanCommand(makeCtx());
    await cmd.run('add A');
    await cmd.run('add B');
    await cmd.run('remove 1');
    const stored = JSON.parse(await fs.readFile(planPath, 'utf8'));
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].title).toBe('B');
  });

  it('promote without args returns usage', async () => {
    const cmd = buildPlanCommand(makeCtx());
    expect((await cmd.run('promote')).message).toContain('Usage:');
  });

  it('promote with unmatched id reports no match', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('promote 99');
    expect(res.message).toContain('No plan item matched');
  });

  it('promote derives todos and updates ctx', async () => {
    const ctx = makeCtx();
    const cmd = buildPlanCommand(ctx);
    await cmd.run('add Build login');
    const res = await cmd.run('promote 1 design ui validate');
    expect(res.message).toContain('Promoted to');
    expect(
      (ctx.context as unknown as { state: { replaceTodos: ReturnType<typeof vi.fn> } }).state
        .replaceTodos,
    ).toHaveBeenCalled();
  });

  it('derive without arg returns usage', async () => {
    const cmd = buildPlanCommand(makeCtx());
    expect((await cmd.run('derive')).message).toContain('Usage:');
  });

  it('derive with unmatched id reports no match', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('derive 42');
    expect(res.message).toContain('No plan item matched');
  });

  it('derive on existing item produces todos', async () => {
    const ctx = makeCtx();
    const cmd = buildPlanCommand(ctx);
    await cmd.run('add Refactor auth');
    const res = await cmd.run('derive 1');
    expect(res.message).toContain('Derived');
  });

  it('template list returns formatted template list', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('template');
    expect(typeof res.message).toBe('string');
    const res2 = await cmd.run('template list');
    expect(typeof res2.message).toBe('string');
  });

  it('template use without name returns usage', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('template use');
    expect(res.message).toContain('Usage:');
  });

  it('template use with unknown name reports error', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('template use does-not-exist');
    expect(res.message).toContain('Unknown template');
  });

  it('template unknown sub-verb reports', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('template frobulate');
    expect(res.message).toContain('Unknown template subcommand');
  });

  it('clear wipes the plan', async () => {
    const cmd = buildPlanCommand(makeCtx());
    await cmd.run('add A');
    const res = await cmd.run('clear');
    expect(res.message).toContain('cleared');
    const stored = JSON.parse(await fs.readFile(planPath, 'utf8'));
    expect(stored.items).toEqual([]);
  });

  it('unknown subcommand reports usage', async () => {
    const cmd = buildPlanCommand(makeCtx());
    const res = await cmd.run('frobulate');
    expect(res.message).toContain('Unknown subcommand');
  });

  it('uses unknown session id when context absent', async () => {
    const cmd = buildPlanCommand(makeCtx({ context: undefined }));
    const res = await cmd.run('add stuff');
    expect(typeof res.message).toBe('string');
    const stored = JSON.parse(await fs.readFile(planPath, 'utf8'));
    expect(stored.sessionId).toBe('unknown');
  });
});
