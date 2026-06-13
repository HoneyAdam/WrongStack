import { DEFAULT_CONTEXT_WINDOW_MODE_ID } from '@wrongstack/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type {
  CompactorLike,
  ContextOpsContext,
} from '../../src/webui-server/ws-handlers/context.js';
import type { WsServerMessage } from '../../src/webui-server/ws-handlers/index.js';
import {
  handleContextClear,
  handleContextCompact,
  handleContextDebug,
  handleContextModeCreate,
  handleContextModeDelete,
  handleContextModeSwitch,
  handleContextModesList,
  handleContextRepair,
} from '../../src/webui-server/ws-handlers/index.js';

/**
 * PR 5n of Issue #30: context ws-handler unit tests.
 *
 * Uses the real (pure) core helpers (estimateContextBreakdown,
 * repairToolUseAdjacency, resolveContextWindowPolicy) and injects the
 * host seams (compactor, mode store, payload builder) via the context.
 */

const FAKE_WS = {} as WebSocket;

const lastOf = (msgs: WsServerMessage[], type: string) =>
  msgs.filter((m) => m.type === type).at(-1);
const resultOf = (sent: WsServerMessage[]) =>
  lastOf(sent, 'key.operation_result')?.payload as
    | { success: boolean; message: string }
    | undefined;

function makeModeStore(modes: Array<Record<string, unknown>> = []) {
  return {
    list: vi.fn(() => modes),
    create: vi.fn(() => ({ ok: true })),
    update: vi.fn(() => ({ ok: true })),
    remove: vi.fn(() => ({ ok: true })),
    save: vi.fn(async () => {}),
  };
}

function makeCtx(over: Partial<ContextOpsContext> = {}): {
  ctx: ContextOpsContext;
  sent: WsServerMessage[];
  bc: WsServerMessage[];
  agentCtx: Record<string, unknown>;
  modeStore: ReturnType<typeof makeModeStore>;
} {
  const sent: WsServerMessage[] = [];
  const bc: WsServerMessage[] = [];
  const agentCtx = {
    meta: {} as Record<string, unknown>,
    systemPrompt: [],
    messages: [],
    tokenCounter: { total: () => ({ input: 100, output: 50 }) },
    state: { replaceMessages: vi.fn(), replaceTodos: vi.fn() },
    readFiles: { clear: vi.fn() },
    fileMtimes: { clear: vi.fn() },
  };
  const modeStore = makeModeStore();
  const ctx: ContextOpsContext = {
    send: (_ws, m) => sent.push(m),
    broadcast: (m) => bc.push(m),
    log: () => {},
    agentCtx: agentCtx as unknown as ContextOpsContext['agentCtx'],
    listTools: () => [],
    resolveCompactor: () => undefined,
    getModeStore: async () => modeStore as never,
    buildSessionStart: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  return { ctx, sent, bc, agentCtx, modeStore };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleContextClear', () => {
  it('wipes in-memory state and broadcasts a reset', async () => {
    const { ctx, sent, bc, agentCtx } = makeCtx();
    await handleContextClear(ctx, FAKE_WS);
    expect(
      (agentCtx.state as { replaceMessages: ReturnType<typeof vi.fn> }).replaceMessages,
    ).toHaveBeenCalledWith([]);
    expect(resultOf(sent)?.message).toContain('Context cleared');
    expect(lastOf(bc, 'session.start')).toBeDefined();
  });
});

describe('handleContextDebug', () => {
  it('sends a breakdown with the active mode', () => {
    const { ctx, sent } = makeCtx();
    handleContextDebug(ctx, FAKE_WS);
    const payload = lastOf(sent, 'context.debug')?.payload as { mode: string };
    expect(payload.mode).toBe(DEFAULT_CONTEXT_WINDOW_MODE_ID);
  });
});

describe('handleContextCompact', () => {
  it('errors when no compactor is available', async () => {
    const { ctx, sent } = makeCtx();
    await handleContextCompact(ctx, FAKE_WS, false);
    expect(resultOf(sent)?.message).toContain('Compactor not available');
  });

  it('reports before/after token totals on success', async () => {
    const compactor: CompactorLike = {
      compact: vi.fn(async () => ({ reductions: [], repaired: true })),
    };
    const { ctx, sent } = makeCtx({ resolveCompactor: () => compactor });
    await handleContextCompact(ctx, FAKE_WS, true);
    const payload = lastOf(sent, 'context.compacted')?.payload as {
      before: number;
      repaired: boolean;
    };
    expect(payload.before).toBe(150);
    expect(payload.repaired).toBe(true);
    expect(resultOf(sent)?.success).toBe(true);
  });
});

describe('handleContextRepair', () => {
  it('reports no orphans for clean messages', () => {
    const { ctx, sent, bc } = makeCtx();
    handleContextRepair(ctx, FAKE_WS);
    expect(lastOf(bc, 'context.repaired')).toBeDefined();
    expect(resultOf(sent)?.message).toContain('no orphan');
  });
});

describe('handleContextModesList', () => {
  it('lists modes and flags the active one', async () => {
    const modes = [
      { id: DEFAULT_CONTEXT_WINDOW_MODE_ID, name: 'Default', description: '', custom: false },
      { id: 'custom-a', name: 'A', description: '', custom: true },
    ];
    const { ctx, sent } = makeCtx({ getModeStore: async () => makeModeStore(modes) as never });
    await handleContextModesList(ctx, FAKE_WS);
    const payload = lastOf(sent, 'context.modes.list')?.payload as {
      activeId: string;
      modes: Array<{ id: string; isActive: boolean }>;
    };
    expect(payload.activeId).toBe(DEFAULT_CONTEXT_WINDOW_MODE_ID);
    expect(payload.modes.find((m) => m.id === DEFAULT_CONTEXT_WINDOW_MODE_ID)?.isActive).toBe(true);
  });
});

describe('handleContextModeSwitch', () => {
  it('switches to a built-in mode', async () => {
    const { ctx, sent, bc, agentCtx } = makeCtx();
    await handleContextModeSwitch(ctx, FAKE_WS, DEFAULT_CONTEXT_WINDOW_MODE_ID);
    expect((agentCtx.meta as Record<string, unknown>)['contextWindowMode']).toBe(
      DEFAULT_CONTEXT_WINDOW_MODE_ID,
    );
    expect(resultOf(sent)?.success).toBe(true);
    expect(lastOf(bc, 'context.mode.changed')).toBeDefined();
  });

  it('errors on an unknown mode id', async () => {
    const { ctx, sent } = makeCtx({ getModeStore: async () => makeModeStore([]) as never });
    await handleContextModeSwitch(ctx, FAKE_WS, 'does-not-exist');
    expect(resultOf(sent)?.success).toBe(false);
    expect(resultOf(sent)?.message).toContain('Unknown context mode');
  });
});

describe('handleContextModeCreate / Delete', () => {
  it('creates a mode and persists', async () => {
    const store = makeModeStore();
    const { ctx, sent } = makeCtx({ getModeStore: async () => store as never });
    await handleContextModeCreate(ctx, FAKE_WS, {
      id: 'm1',
      name: 'M1',
      description: 'd',
      thresholds: { warn: 0.6, soft: 0.75, hard: 0.9 },
      preserveK: 4,
      eliseThreshold: 0.5,
    });
    expect(store.create).toHaveBeenCalled();
    expect(store.save).toHaveBeenCalled();
    expect(resultOf(sent)?.success).toBe(true);
  });

  it('resets the active mode to default when deleting it', async () => {
    const store = makeModeStore();
    const { ctx, sent, agentCtx } = makeCtx({ getModeStore: async () => store as never });
    (agentCtx.meta as Record<string, unknown>)['contextWindowMode'] = 'm1';
    await handleContextModeDelete(ctx, FAKE_WS, 'm1');
    expect((agentCtx.meta as Record<string, unknown>)['contextWindowMode']).toBe(
      DEFAULT_CONTEXT_WINDOW_MODE_ID,
    );
    expect(store.remove).toHaveBeenCalledWith('m1');
    expect(resultOf(sent)?.success).toBe(true);
  });
});
