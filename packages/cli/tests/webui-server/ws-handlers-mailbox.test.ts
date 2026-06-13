import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../../src/webui-server/ws-handlers/index.js';
import {
  handleMailboxAgents,
  handleMailboxClear,
  handleMailboxMessages,
} from '../../src/webui-server/ws-handlers/index.js';
import type { MailboxContext } from '../../src/webui-server/ws-handlers/mailbox.js';

/**
 * PR 5k of Issue #30: mailbox ws-handler unit tests.
 *
 * Mocks @wrongstack/core's GlobalMailbox + resolveProjectDir so the
 * handlers can be exercised without a real per-project mailbox on disk.
 */

const FAKE_WS = {} as WebSocket;

const mockMailbox = {
  query: vi.fn(),
  getOnlineAgents: vi.fn(),
  getAgentStatuses: vi.fn(),
  clearAll: vi.fn(),
};

vi.mock('@wrongstack/core', async () => {
  const actual = await vi.importActual<typeof import('@wrongstack/core')>('@wrongstack/core');
  return {
    ...actual,
    resolveProjectDir: (root: string) => `/data/${root}`,
    // Regular function (not an arrow) so `new GlobalMailbox(...)` works —
    // vi.fn(arrow) is not constructable; returning an object from the
    // constructor makes `new` yield that object.
    // biome-ignore lint/complexity/useArrowFunction: must be `new`-constructable
    GlobalMailbox: vi.fn(function () {
      return mockMailbox;
    }),
  };
});

beforeEach(() => {
  mockMailbox.query.mockReset();
  mockMailbox.getOnlineAgents.mockReset();
  mockMailbox.getAgentStatuses.mockReset();
  mockMailbox.clearAll.mockReset();
});

function makeCtx(over: Partial<MailboxContext> = {}): {
  ctx: MailboxContext;
  sent: WsServerMessage[];
} {
  const sent: WsServerMessage[] = [];
  const ctx: MailboxContext = {
    send: (_ws, m) => sent.push(m),
    broadcast: () => {},
    log: () => {},
    projectRoot: '/tmp/project',
    globalRoot: '/home/.wrongstack',
    ...over,
  };
  return { ctx, sent };
}

const lastOf = (msgs: WsServerMessage[], type: string) =>
  msgs.filter((m) => m.type === type).at(-1);

describe('handleMailboxMessages', () => {
  it('maps queried messages into the wire shape', async () => {
    const { ctx, sent } = makeCtx();
    mockMailbox.query.mockResolvedValue([
      {
        id: 'm1',
        from: 'a',
        to: 'b',
        type: 'task',
        subject: 's',
        body: 'hi',
        priority: 'normal',
        readBy: { b: '2026-01-01' },
        completed: false,
        timestamp: 't',
      },
    ]);
    await handleMailboxMessages(ctx, FAKE_WS, { limit: 10 });
    const payload = lastOf(sent, 'mailbox.messages')?.payload as { messages: unknown[] };
    expect(payload.messages).toHaveLength(1);
    expect((payload.messages[0] as { readByCount: number }).readByCount).toBe(1);
  });

  it('errors when project root is missing', async () => {
    const { ctx, sent } = makeCtx({ projectRoot: '' });
    await handleMailboxMessages(ctx, FAKE_WS, undefined);
    const payload = lastOf(sent, 'mailbox.messages')?.payload as { error: string };
    expect(payload.error).toContain('No project root');
  });

  it('reports query failures as an error payload', async () => {
    const { ctx, sent } = makeCtx();
    mockMailbox.query.mockRejectedValue(new Error('boom'));
    await handleMailboxMessages(ctx, FAKE_WS, undefined);
    const payload = lastOf(sent, 'mailbox.messages')?.payload as { error: string };
    expect(payload.error).toBe('boom');
  });
});

describe('handleMailboxAgents', () => {
  it('uses getOnlineAgents when onlineOnly is set', async () => {
    const { ctx, sent } = makeCtx();
    mockMailbox.getOnlineAgents.mockResolvedValue([{ agentId: 'x', name: 'X', online: true }]);
    await handleMailboxAgents(ctx, FAKE_WS, { onlineOnly: true });
    expect(mockMailbox.getOnlineAgents).toHaveBeenCalled();
    const payload = lastOf(sent, 'mailbox.agents')?.payload as { agents: unknown[] };
    expect(payload.agents).toHaveLength(1);
  });

  it('uses getAgentStatuses by default', async () => {
    const { ctx, sent } = makeCtx();
    mockMailbox.getAgentStatuses.mockResolvedValue([]);
    await handleMailboxAgents(ctx, FAKE_WS, undefined);
    expect(mockMailbox.getAgentStatuses).toHaveBeenCalled();
    expect(lastOf(sent, 'mailbox.agents')).toBeDefined();
  });
});

describe('handleMailboxClear', () => {
  it('clears the mailbox and confirms', async () => {
    const { ctx, sent } = makeCtx();
    mockMailbox.clearAll.mockResolvedValue(undefined);
    await handleMailboxClear(ctx, FAKE_WS);
    expect(mockMailbox.clearAll).toHaveBeenCalled();
    expect(lastOf(sent, 'mailbox.cleared')?.payload).toEqual({});
  });

  it('errors when global root is missing', async () => {
    const { ctx, sent } = makeCtx({ globalRoot: '' });
    await handleMailboxClear(ctx, FAKE_WS);
    const payload = lastOf(sent, 'mailbox.cleared')?.payload as { error: string };
    expect(payload.error).toContain('No project root');
  });
});
