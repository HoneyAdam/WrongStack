import { beforeEach, describe, expect, it, vi } from 'vitest';

// ws-handlers reaches for the live socket — stub it so handlers run server-less.
vi.mock('@/lib/ws-client', () => ({
  getWSClient: () => ({ send: vi.fn() }),
}));

import { WS_HANDLERS } from '../../src/hooks/ws-handlers';
import { useMonitorStore } from '../../src/stores/monitor-store';

function fire(type: string, payload: Record<string, unknown>) {
  WS_HANDLERS[type]?.({ type, payload } as never);
}

describe('sessions.status_update → monitor store', () => {
  beforeEach(() => {
    useMonitorStore.getState().clear();
  });

  it('drives client/agent counts from the cross-process snapshot (multi-TUI)', () => {
    fire('sessions.status_update', {
      sessions: [
        {
          sessionId: 'a',
          clientType: 'tui',
          pid: 1,
          agents: [{ id: 'a1', name: 'A1', status: 'running' }],
        },
        { sessionId: 'b', clientType: 'tui', pid: 2, agents: [] },
        { sessionId: 'c', clientType: 'webui', pid: 3, agents: [] },
        {
          sessionId: 'd',
          clientType: 'cli',
          pid: 4,
          agents: [{ id: 'd1', name: 'D1', status: 'idle' }],
        },
      ],
    });

    const state = useMonitorStore.getState();
    expect(state.liveSessions).toHaveLength(4);
    expect(state.clientCounts).toEqual({ tui: 2, webui: 1, repl: 1 });
    expect(state.totalAgents).toBe(2);
    expect(state.activeAgents).toBe(1);
  });

  it('handles an empty / missing sessions payload', () => {
    // Seed something, then send an empty snapshot.
    fire('sessions.status_update', {
      sessions: [{ sessionId: 'a', clientType: 'webui', pid: 1, agents: [] }],
    });
    fire('sessions.status_update', {});

    const state = useMonitorStore.getState();
    expect(state.liveSessions).toEqual([]);
    expect(state.clientCounts).toEqual({ tui: 0, webui: 0, repl: 0 });
  });

  it('client.status_update no longer overwrites fleet-wide client counts', () => {
    // Snapshot says there are two TUIs and a webui.
    fire('sessions.status_update', {
      sessions: [
        { sessionId: 'a', clientType: 'tui', pid: 1, agents: [] },
        { sessionId: 'b', clientType: 'tui', pid: 2, agents: [] },
        { sessionId: 'c', clientType: 'webui', pid: 3, agents: [] },
      ],
    });
    // The attached webui session reports its own status — must NOT pin counts to 1.
    fire('client.status_update', {
      clientType: 'webui',
      clientId: 'webui@1',
      model: 'm',
      mode: 'auto',
    });

    const state = useMonitorStore.getState();
    expect(state.clientCounts).toEqual({ tui: 2, webui: 1, repl: 0 });
    // ...but it does update the HUD detail for the attached session.
    expect(state.currentSession.model).toBe('m');
    expect(state.currentSession.mode).toBe('auto');
  });
});
