import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { MemoryContextWidget } from '../src/components/memory-context-widget.js';
import {
  activeMemoryContextCount,
  applyMemoryContextSnapshot,
  applyMemoryInjectorRun,
  emptyMemoryContextMonitor,
  memoryEventMatchesSession,
  readMemoryRecordTotal,
} from '../src/memory-context-monitor.js';

describe('TUI memory context monitor', () => {
  it('keeps the ordinary widget to two summary lines and tracks exact exits', () => {
    const injected = applyMemoryInjectorRun(emptyMemoryContextMonitor(), {
      at: '2026-07-19T16:00:00.000Z',
      trigger: 'read',
      candidates: 5,
      contextPressure: 0.42,
      injectedChars: 380,
      rejected: { belowScore: 2 },
      injected: [
        {
          id: 'mem_auth',
          kind: 'fact',
          text: 'Rotate refresh tokens.',
          score: 0.9,
          confidence: 0.95,
          freshness: 0.8,
          importance: 0.9,
          persistence: 'long_lived',
          anchors: [],
          tags: ['auth'],
          activationReasons: ['tag:#auth'],
        },
        { id: 'mem_second', text: 'Second memory.' },
        { id: 'mem_third', text: 'Third memory.' },
      ],
    });
    const view = render(React.createElement(MemoryContextWidget, { state: injected }));
    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(frame).toContain('5 matched · 3 injected · 2 filtered · 0 ctx · 3 pending');
    expect(frame).toContain('/context = details');
    expect(frame).not.toContain('Rotate refresh tokens');
    expect(activeMemoryContextCount(injected)).toBe(0);

    const active = applyMemoryContextSnapshot(injected, {
      at: '2026-07-19T16:00:01.000Z',
      activeMemoryIds: ['mem_auth', 'mem_second', 'mem_third'],
      enteredMemoryIds: ['mem_auth', 'mem_second', 'mem_third'],
      exitedMemoryIds: [],
    });
    expect(activeMemoryContextCount(active)).toBe(3);
    const activeView = render(React.createElement(MemoryContextWidget, { state: active }));
    expect(activeView.lastFrame() ?? '').toContain('3 ctx');
    expect(activeView.lastFrame() ?? '').not.toContain('pending');
    activeView.unmount();

    const reinjected = applyMemoryInjectorRun(active, {
      at: '2026-07-19T16:00:01.500Z',
      trigger: 'read',
      candidates: 1,
      injected: [{ id: 'mem_auth', text: 'Rotate refresh tokens.' }],
    });
    expect(activeMemoryContextCount(reinjected)).toBe(3);

    const exited = applyMemoryContextSnapshot(active, {
      at: '2026-07-19T16:00:02.000Z',
      activeMemoryIds: [],
      enteredMemoryIds: [],
      exitedMemoryIds: ['mem_auth', 'mem_second', 'mem_third'],
    });
    expect(Object.values(exited.memories).every((memory) => memory.state === 'exited')).toBe(true);
    expect(activeMemoryContextCount(exited)).toBe(0);

    const authoritativeEmptySnapshot = applyMemoryContextSnapshot(active, {
      at: '2026-07-19T16:00:03.000Z',
      activeMemoryIds: [],
      enteredMemoryIds: [],
      exitedMemoryIds: [],
    });
    expect(activeMemoryContextCount(authoritativeEmptySnapshot)).toBe(0);
  });

  it('reads the all-status record total from a SAGE-compatible store', async () => {
    expect(await readMemoryRecordTotal({ stats: async () => ({ total: 6261 }) })).toBe(6261);
    expect(await readMemoryRecordTotal({})).toBeUndefined();
  });

  it('keeps leader context telemetry isolated from subagent sessions', () => {
    expect(memoryEventMatchesSession({ sessionId: 'leader' }, 'leader')).toBe(true);
    expect(memoryEventMatchesSession({ sessionId: 'subagent-1' }, 'leader')).toBe(false);
    expect(memoryEventMatchesSession({}, 'leader')).toBe(true);
  });
});
