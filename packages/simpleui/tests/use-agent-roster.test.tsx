// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentRoster } from '../src/hooks/use-agent-roster.js';
import { LEADER_AGENT_ID } from '../src/lib/agent-model.js';
import type { AgentTranscriptEntry, SimpleSubagent } from '../src/types.js';

interface Captured {
  current: ReturnType<typeof useAgentRoster>;
}

const roots: Root[] = [];

function renderHookViaRoot(captured: Captured, running: boolean): void {
  function Probe(): null {
    captured.current = useAgentRoster({ running });
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<Probe />));
}

function transcriptEntry(id: string): AgentTranscriptEntry {
  return {
    id,
    subagentId: id,
    agentName: 'TEST',
    content: 'content',
    kind: 'text',
    iteration: 1,
    ts: '2026-07-15T12:00:00.000Z',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAgentRoster — initial state', () => {
  it('starts empty with leader selected', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    expect(captured.current.subagents).toEqual([]);
    expect(captured.current.selectedAgentId).toBe(LEADER_AGENT_ID);
    expect(captured.current.agentTranscripts).toEqual({});
    expect(captured.current.activeAgentId).toBe(LEADER_AGENT_ID);
    expect(captured.current.leaderSelected).toBe(true);
  });
});

describe('useAgentRoster — derived tab lists', () => {
  it('places the leader first and mirrors running status', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, true);

    const tabs = captured.current.agentTabs;
    expect(tabs[0]?.id).toBe(LEADER_AGENT_ID);
    expect(tabs[0]?.status).toBe('running');

    // Without workers there's exactly one tab (leader).
    expect(tabs).toHaveLength(1);
    expect(captured.current.liveAgentTabs).toHaveLength(1);
    expect(captured.current.finishedAgentTabs).toHaveLength(0);
  });

  it('shows leader as idle when running is false', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    expect(captured.current.agentTabs[0]?.status).toBe('idle');
  });

  it('partitions active and finished workers correctly', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    const activeWorker: SimpleSubagent = {
      id: 'worker-active',
      name: 'Active',
      status: 'running',
      task: 'fixing',
    };
    const finishedWorker: SimpleSubagent = {
      id: 'worker-done',
      name: 'Done',
      status: 'completed',
    };

    act(() => {
      captured.current.setSubagents([activeWorker, finishedWorker]);
    });

    const { liveAgentTabs, finishedAgentTabs } = captured.current;
    // Leader + active worker in live; finished worker in dropdown.
    expect(liveAgentTabs.map((t) => t.id)).toContain(LEADER_AGENT_ID);
    expect(liveAgentTabs.map((t) => t.id)).toContain('worker-active');
    expect(finishedAgentTabs.map((t) => t.id)).toContain('worker-done');
  });
});

describe('useAgentRoster — selection resolution', () => {
  it('falls back to leader when selected tab disappears', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    // Add a worker, select it, then remove it.
    const worker: SimpleSubagent = {
      id: 'worker-x',
      name: 'X',
      status: 'running',
    };

    act(() => captured.current.setSubagents([worker]));
    act(() => captured.current.setSelectedAgentId('worker-x'));
    expect(captured.current.activeAgentId).toBe('worker-x');
    expect(captured.current.leaderSelected).toBe(false);

    act(() => captured.current.setSubagents([]));
    expect(captured.current.activeAgentId).toBe(LEADER_AGENT_ID);
    expect(captured.current.leaderSelected).toBe(true);
  });

  it('exposes activeAgent as the matching tab object', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    expect(captured.current.activeAgent?.id).toBe(LEADER_AGENT_ID);
  });
});

describe('useAgentRoster — setter exposure', () => {
  it('setSubagents, setAgentTranscripts, setSelectedAgentId are callable', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    const worker: SimpleSubagent = { id: 'w', name: 'W', status: 'running' };
    act(() => captured.current.setSubagents([worker]));
    expect(captured.current.subagents).toEqual([worker]);

    act(() =>
      captured.current.setAgentTranscripts({
        w: [transcriptEntry('e1')],
      }),
    );
    expect(captured.current.agentTranscripts['w']).toHaveLength(1);

    act(() => captured.current.setSelectedAgentId('w'));
    expect(captured.current.selectedAgentId).toBe('w');
  });

  it('supports functional updater form for setSubagents', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    const w1: SimpleSubagent = { id: 'w1', name: 'W1', status: 'running' };
    const w2: SimpleSubagent = { id: 'w2', name: 'W2', status: 'idle' };

    act(() => captured.current.setSubagents([w1]));
    act(() => captured.current.setSubagents((prev) => [...prev, w2]));
    expect(captured.current.subagents).toHaveLength(2);
  });
});

describe('useAgentRoster — prune interval', () => {
  it('does not start when subagents is empty', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    // Advance well past the 15s mark — nothing should crash or change state.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(captured.current.subagents).toEqual([]);
  });

  it('starts a prune interval when workers exist and does not crash', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    // Add a worker; the interval should start without error.
    const worker: SimpleSubagent = {
      id: 'worker-test',
      name: 'Test',
      status: 'running',
    };
    act(() => captured.current.setSubagents([worker]));

    // Advance past the 15s interval — the prune callback fires.
    // We don't assert on the worker being pruned here because prune logic
    // is unit-tested in agent-model.test.ts; this test only verifies the
    // interval starts and doesn't throw.
    expect(() => {
      act(() => {
        vi.setSystemTime(new Date(80_000));
        vi.advanceTimersByTime(80_000);
      });
    }).not.toThrow();

    // The active (running) worker should survive regardless.
    expect(captured.current.subagents.map((s) => s.id)).toContain('worker-test');
  });

  it('keeps active (running) workers through prune', () => {
    const captured: Captured = { current: undefined as never };
    renderHookViaRoot(captured, false);

    const activeWorker: SimpleSubagent = {
      id: 'active-w',
      name: 'Active',
      status: 'running',
    };
    act(() => captured.current.setSubagents([activeWorker]));

    act(() => {
      vi.setSystemTime(new Date(80_000));
      vi.advanceTimersByTime(80_000);
    });

    expect(captured.current.subagents.map((s) => s.id)).toContain('active-w');
  });
});
