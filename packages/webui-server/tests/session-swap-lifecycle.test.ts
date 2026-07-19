import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { sessionScopedPath } from '@wrongstack/core/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionHandlers } from '../src/server/session-handlers.js';

describe('standalone WebUI session swap lifecycle', () => {
  let root: string;
  let sessionsDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-webui-session-swap-'));
    sessionsDir = path.join(root, 'canonical-sessions');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('finalizes the old writer and re-points sidecars and identity on session.new', async () => {
    const old = writer('2026-07-12/sess_old');
    const next = writer('2026-07-12/sess_new');
    const harness = makeHarness({ root, sessionsDir, current: old, created: next });

    await harness.routes.newSession(harness.ws, {
      type: 'session.new',
      payload: { sessionId: old.id },
    });

    expect(old.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'session_end' }));
    expect(old.close).toHaveBeenCalledOnce();
    expect(harness.current()).toBe(next);
    expect(harness.context.session).toBe(next);
    expect(harness.context.state.replaceMessages).toHaveBeenLastCalledWith([]);
    expect(harness.context.state.replaceTodos).toHaveBeenLastCalledWith([]);
    expect(harness.context.lastRequestTokens).toBeUndefined();
    expect(harness.context.lastRealInputTokens).toBeUndefined();
    expect(harness.context.state.deleteMeta).toHaveBeenCalledWith('lastRequestTokensAt');
    expect(harness.context.state.deleteMeta).toHaveBeenCalledWith('realAnchorMsgCount');
    expect(harness.onSessionSwapped).toHaveBeenCalledWith(next.id);
    expect(harness.meta.get('plan.path')).toBe(
      sessionScopedPath(sessionsDir, next.id, '.plan.json'),
    );
    expect(harness.meta.get('task.path')).toBe(
      sessionScopedPath(sessionsDir, next.id, '.tasks.json'),
    );
  });

  it('hydrates a resumed writer only after finalizing the previous writer', async () => {
    const old = writer('2026-07-12/sess_old');
    const resumed = writer('2026-07-11/sess_resumed');
    const messages = [{ role: 'user', content: 'restored' }];
    const usage = { input: 12, output: 7, cacheRead: 0, cacheWrite: 0 };
    const harness = makeHarness({
      root,
      sessionsDir,
      current: old,
      resumed,
      resumedMessages: messages,
      resumedUsage: usage,
    });

    await harness.routes.resumeSession(harness.ws, {
      type: 'session.resume',
      payload: { id: resumed.id },
    });

    expect(old.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'session_end' }));
    expect(old.close).toHaveBeenCalledOnce();
    expect(harness.current()).toBe(resumed);
    expect(harness.context.state.replaceMessages).toHaveBeenLastCalledWith(messages);
    expect(harness.context.state.replaceTodos).toHaveBeenLastCalledWith([]);
    expect(harness.tokenCounter.account).toHaveBeenCalledWith(usage, 'test-model', 'test-provider');
    expect(harness.onSessionSwapped).toHaveBeenCalledWith(resumed.id);
    expect(harness.ws.sent.at(-1)).toMatchObject({
      type: 'key.operation_result',
      payload: { success: true },
    });
  });

  it('reads checkpoints from canonical date-sharded projectSessions', async () => {
    const current = writer('2026-07-12/sess_checkpoint');
    const harness = makeHarness({ root, sessionsDir, current });
    const sessionFile = sessionScopedPath(sessionsDir, current.id, '.jsonl');
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(
      sessionFile,
      `${JSON.stringify({
        type: 'checkpoint',
        ts: '2026-07-12T00:00:00.000Z',
        promptIndex: 3,
        promptPreview: 'canonical checkpoint',
      })}\n`,
      'utf8',
    );

    await harness.routes.listCheckpoints(harness.ws, {
      type: 'session.checkpoints',
      payload: { sessionId: current.id },
    });

    expect(harness.ws.sent.at(-1)).toMatchObject({
      type: 'session.checkpoints',
      payload: {
        sessionId: current.id,
        checkpoints: [
          expect.objectContaining({
            promptIndex: 3,
            promptPreview: 'canonical checkpoint',
          }),
        ],
      },
    });
  });
});

function writer(id: string) {
  return {
    id,
    append: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    truncateToCheckpoint: vi.fn(async () => undefined),
  };
}

function makeHarness(input: {
  root: string;
  sessionsDir: string;
  current: ReturnType<typeof writer>;
  created?: ReturnType<typeof writer> | undefined;
  resumed?: ReturnType<typeof writer> | undefined;
  resumedMessages?: unknown[] | undefined;
  resumedUsage?: Record<string, number> | undefined;
}) {
  let current = input.current;
  const meta = new Map<string, unknown>();
  const context = {
    session: current,
    messages: [],
    provider: { id: 'test-provider' },
    lastRequestTokens: 999,
    lastRealInputTokens: 888,
    state: {
      replaceMessages: vi.fn(),
      replaceTodos: vi.fn(),
      setMeta: vi.fn((key: string, value: unknown) => meta.set(key, value)),
      deleteMeta: vi.fn((key: string) => meta.delete(key)),
    },
    readFiles: new Set<string>(),
    fileMtimes: new Map<string, number>(),
  };
  const tokenCounter = {
    total: vi.fn(() => ({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 })),
    reset: vi.fn(),
    account: vi.fn(),
  };
  const onSessionSwapped = vi.fn(async () => undefined);
  const ws = {
    readyState: 1,
    sent: [] as Array<{ type: string; payload: unknown }>,
    send(data: string) {
      this.sent.push(JSON.parse(data) as { type: string; payload: unknown });
    },
  };
  const store = {
    create: vi.fn(async () => input.created),
    resume: vi.fn(async () => ({
      writer: input.resumed,
      data: {
        messages: input.resumedMessages ?? [],
        usage: input.resumedUsage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    })),
  };
  const routes = createSessionHandlers({
    config: { provider: 'test-provider', model: 'test-model' },
    clients: new Map(),
    context: context as never,
    toolRegistry: {} as never,
    compactor: {} as never,
    customModeStore: {} as never,
    tokenCounter: tokenCounter as never,
    getProjectRoot: () => input.root,
    getSession: () => current as never,
    getSessionStore: () => store as never,
    sessionsDir: input.sessionsDir,
    setSession: (next) => {
      current = next as typeof current;
    },
    setSessionStartedAt: vi.fn(),
    onSessionSwapped,
    sessionStartPayload: async () => ({
      sessionId: current.id,
      model: 'test-model',
      provider: 'test-provider',
      maxContext: 100,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      projectName: 'test',
      projectRoot: input.root,
      cwd: input.root,
      mode: 'default',
      contextMode: 'balanced',
    }),
  });

  return {
    routes,
    ws: ws as never as typeof ws,
    context,
    tokenCounter,
    onSessionSwapped,
    meta,
    current: () => current,
  };
}
