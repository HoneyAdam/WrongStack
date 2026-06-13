import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../../src/webui-server/ws-handlers/index.js';
import { handleWorkingDirSet } from '../../src/webui-server/ws-handlers/index.js';
import type { WorkingDirContext } from '../../src/webui-server/ws-handlers/working-dir.js';

/**
 * PR 5j of Issue #30: working_dir.set ws-handler unit tests.
 *
 * Mocks node:fs/promises so directory validation is deterministic.
 */

const FAKE_WS = {} as WebSocket;
const ROOT = path.resolve('/tmp/project');

function makeCtx(over: Partial<WorkingDirContext> = {}): {
  ctx: WorkingDirContext;
  sent: WsServerMessage[];
  bc: WsServerMessage[];
} {
  const sent: WsServerMessage[] = [];
  const bc: WsServerMessage[] = [];
  const ctx: WorkingDirContext = {
    send: (_ws, m) => sent.push(m),
    broadcast: (m) => bc.push(m),
    log: () => {},
    agentCtx: { cwd: ROOT, projectRoot: ROOT },
    projectRoot: ROOT,
    ...over,
  };
  return { ctx, sent, bc };
}

const lastOf = (msgs: WsServerMessage[], type: string) =>
  msgs.filter((m) => m.type === type).at(-1);

const resultOf = (sent: WsServerMessage[]) =>
  lastOf(sent, 'key.operation_result')?.payload as
    | { success: boolean; message: string }
    | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, stat: vi.fn() };
});

describe('handleWorkingDirSet', () => {
  it('updates cwd and broadcasts when the path is a directory inside root', async () => {
    const { ctx, sent, bc } = makeCtx();
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);
    await handleWorkingDirSet(ctx, FAKE_WS, 'src');
    const target = path.resolve(ROOT, 'src');
    expect(ctx.agentCtx.cwd).toBe(target);
    expect(lastOf(bc, 'working_dir.changed')?.payload).toEqual({
      cwd: target,
      projectRoot: ROOT,
    });
    expect(resultOf(sent)?.success).toBe(true);
  });

  it('rejects paths that escape the project root', async () => {
    const { ctx, sent, bc } = makeCtx();
    await handleWorkingDirSet(ctx, FAKE_WS, '../../etc');
    expect(resultOf(sent)?.success).toBe(false);
    expect(resultOf(sent)?.message).toContain('stay inside the project root');
    expect(bc).toHaveLength(0);
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it('rejects when the path is not a directory', async () => {
    const { ctx, sent } = makeCtx();
    vi.mocked(fs.stat).mockResolvedValue(null as never);
    await handleWorkingDirSet(ctx, FAKE_WS, 'missing');
    expect(resultOf(sent)?.success).toBe(false);
    expect(resultOf(sent)?.message).toContain('not found');
  });

  it('falls back to agentCtx.projectRoot when projectRoot is undefined', async () => {
    const { ctx, sent } = makeCtx({ projectRoot: undefined });
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);
    await handleWorkingDirSet(ctx, FAKE_WS, '.');
    expect(resultOf(sent)?.success).toBe(true);
  });
});
