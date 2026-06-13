import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../../src/webui-server/ws-handlers/index.js';
import {
  handleSessionCheckpoints,
  handleSessionDelete,
  handleSessionNew,
  handleSessionResume,
  handleSessionRewind,
  handleSessionSave,
  handleSessionsList,
} from '../../src/webui-server/ws-handlers/index.js';
import type { SessionContext } from '../../src/webui-server/ws-handlers/session.js';

/**
 * PR 5m of Issue #30: session ws-handler unit tests.
 *
 * Mocks the session store + rewinder so the lifecycle handlers run
 * without touching disk.
 */

const FAKE_WS = {} as WebSocket;

const rewinder = {
  listCheckpoints: vi.fn(),
  rewindToCheckpoint: vi.fn(),
};
vi.mock('@wrongstack/core', async () => {
  const actual = await vi.importActual<typeof import('@wrongstack/core')>('@wrongstack/core');
  return {
    ...actual,
    // Non-arrow so `new DefaultSessionRewinder(...)` is constructable.
    // biome-ignore lint/complexity/useArrowFunction: must be `new`-constructable
    DefaultSessionRewinder: vi.fn(function () {
      return rewinder;
    }),
  };
});
vi.mock('@wrongstack/core/storage', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be `new`-constructable
  DefaultSessionStore: vi.fn(function () {
    return { list: vi.fn(async () => []), delete: vi.fn(async () => {}) };
  }),
}));

const lastOf = (msgs: WsServerMessage[], type: string) =>
  msgs.filter((m) => m.type === type).at(-1);
const resultOf = (sent: WsServerMessage[]) =>
  lastOf(sent, 'key.operation_result')?.payload as
    | { success: boolean; message: string }
    | undefined;

function makeCtx(over: Partial<SessionContext> = {}): {
  ctx: SessionContext;
  sent: WsServerMessage[];
  bc: WsServerMessage[];
  store: Record<string, ReturnType<typeof vi.fn>>;
  agent: {
    session: Record<string, ReturnType<typeof vi.fn> | string>;
    tokenCounter: Record<string, ReturnType<typeof vi.fn> | (() => unknown)>;
  };
} {
  const sent: WsServerMessage[] = [];
  const bc: WsServerMessage[] = [];
  const store = {
    list: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    create: vi.fn(async () => ({ id: 'fresh-sess' })),
    resume: vi.fn(),
  };
  const session = {
    id: 'live-sess',
    append: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    truncateToCheckpoint: vi.fn(async () => {}),
  };
  const agentCtx = {
    session,
    tokenCounter: { total: () => ({ input: 1, output: 2 }), reset: vi.fn(), account: vi.fn() },
    model: 'm',
    provider: { id: 'p' },
    projectRoot: '/proj',
    state: { replaceMessages: vi.fn(), replaceTodos: vi.fn() },
    readFiles: { clear: vi.fn() },
    fileMtimes: { clear: vi.fn() },
  };
  const ctx: SessionContext = {
    send: (_ws, m) => sent.push(m),
    broadcast: (m) => bc.push(m),
    log: () => {},
    sessionStore: store as unknown as SessionContext['sessionStore'],
    agentCtx: agentCtx as unknown as SessionContext['agentCtx'],
    startupSession: {
      id: 'startup',
      truncateToCheckpoint: vi.fn(async () => {}),
    } as unknown as SessionContext['startupSession'],
    projectRoot: '/proj',
    sessionsDir: undefined,
    onSessionSwapped: vi.fn(),
    buildSessionStart: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  return { ctx, sent, bc, store, agent: { session, tokenCounter: agentCtx.tokenCounter } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleSessionsList', () => {
  it('maps sessions and flags the current one', async () => {
    const { ctx, sent, store } = makeCtx();
    store.list.mockResolvedValue([
      { id: 'live-sess', title: 'T', startedAt: 'x', model: 'm', provider: 'p', tokenTotal: 9 },
      { id: 'other', title: 'O', startedAt: 'y', model: 'm', provider: 'p', tokenTotal: 1 },
    ]);
    await handleSessionsList(ctx, FAKE_WS, 50);
    const payload = lastOf(sent, 'sessions.list')?.payload as {
      sessions: Array<{ id: string; isCurrent: boolean }>;
    };
    expect(payload.sessions.find((s) => s.id === 'live-sess')?.isCurrent).toBe(true);
    expect(payload.sessions.find((s) => s.id === 'other')?.isCurrent).toBe(false);
  });
});

describe('handleSessionNew', () => {
  it('finalizes the old writer, creates a fresh one, and broadcasts', async () => {
    const { ctx, bc, store, agent } = makeCtx();
    await handleSessionNew(ctx, FAKE_WS);
    expect(store.create).toHaveBeenCalled();
    expect(ctx.onSessionSwapped).toHaveBeenCalledWith('fresh-sess');
    expect(agent.tokenCounter.reset).toHaveBeenCalled();
    expect(lastOf(bc, 'session.start')).toBeDefined();
  });

  it('still resets in-memory state when no store is wired', async () => {
    const { ctx, bc } = makeCtx({ sessionStore: undefined });
    await handleSessionNew(ctx, FAKE_WS);
    expect(ctx.onSessionSwapped).not.toHaveBeenCalled();
    expect(lastOf(bc, 'session.start')).toBeDefined();
  });
});

describe('handleSessionDelete', () => {
  it('refuses to delete the active session', async () => {
    const { ctx, sent, store } = makeCtx();
    await handleSessionDelete(ctx, FAKE_WS, 'live-sess');
    expect(store.delete).not.toHaveBeenCalled();
    expect(resultOf(sent)?.success).toBe(false);
  });

  it('deletes a non-active session', async () => {
    const { ctx, sent, store } = makeCtx();
    await handleSessionDelete(ctx, FAKE_WS, 'other');
    expect(store.delete).toHaveBeenCalledWith('other');
    expect(resultOf(sent)?.success).toBe(true);
  });
});

describe('handleSessionSave', () => {
  it('confirms auto-save using the startup session id', () => {
    const { ctx, sent } = makeCtx();
    handleSessionSave(ctx, FAKE_WS);
    expect(resultOf(sent)?.success).toBe(true);
    expect(resultOf(sent)?.message).toContain('startup');
  });
});

describe('handleSessionResume', () => {
  it('errors when no store is wired', async () => {
    const { ctx, sent } = makeCtx({ sessionStore: undefined });
    await handleSessionResume(ctx, FAKE_WS, 'x');
    expect(resultOf(sent)?.message).toContain('not available');
  });

  it('refuses to resume the already-active session', async () => {
    const { ctx, sent, store } = makeCtx();
    await handleSessionResume(ctx, FAKE_WS, 'live-sess');
    expect(store.resume).not.toHaveBeenCalled();
    expect(resultOf(sent)?.message).toContain('already active');
  });

  it('swaps to the resumed writer and replays usage', async () => {
    const { ctx, sent, bc, store, agent } = makeCtx();
    store.resume.mockResolvedValue({
      writer: { id: 'resumed', append: vi.fn(), close: vi.fn() },
      data: { messages: [{ role: 'user' }], usage: { input: 5 } },
    });
    await handleSessionResume(ctx, FAKE_WS, 'resumed');
    expect(ctx.onSessionSwapped).toHaveBeenCalledWith('resumed');
    expect(agent.tokenCounter.account).toHaveBeenCalled();
    expect(lastOf(bc, 'session.start')).toBeDefined();
    expect(resultOf(sent)?.success).toBe(true);
  });
});

describe('handleSessionCheckpoints / Rewind', () => {
  it('lists checkpoints for the live session', async () => {
    const { ctx, sent } = makeCtx();
    rewinder.listCheckpoints.mockResolvedValue([{ index: 0 }]);
    await handleSessionCheckpoints(ctx, FAKE_WS);
    expect(rewinder.listCheckpoints).toHaveBeenCalledWith('live-sess');
    const payload = lastOf(sent, 'session.checkpoints')?.payload as { checkpoints: unknown[] };
    expect(payload.checkpoints).toHaveLength(1);
  });

  it('rewinds the live session and truncates its writer', async () => {
    const { ctx, sent, bc, agent } = makeCtx();
    rewinder.rewindToCheckpoint.mockResolvedValue(undefined);
    await handleSessionRewind(ctx, FAKE_WS, 3);
    expect(rewinder.rewindToCheckpoint).toHaveBeenCalledWith('live-sess', 3);
    expect(agent.session.truncateToCheckpoint).toHaveBeenCalledWith(3);
    expect(lastOf(bc, 'session.start')).toBeDefined();
    expect(resultOf(sent)?.success).toBe(true);
  });
});
