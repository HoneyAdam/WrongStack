import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { Entry, type HistoryEntry } from '../src/components/history.js';

function memoryEntry(injected: boolean): HistoryEntry {
  return {
    id: 1,
    kind: 'memory-activation',
    trigger: 'read',
    outcome: injected ? 'injected' : 'empty',
    candidates: 7,
    contextPressure: 0.42,
    injectedChars: injected ? 420 : 0,
    activated: [{
      id: 'mem_auth_contract',
      kind: 'symbol_note',
      text: 'refreshSession rotates the refresh token before returning.',
      score: 0.91,
      relationStrength: 0.95,
      anchors: ['symbol:src/auth/session.ts#refreshSession'],
      tags: ['auth', 'refresh-token'],
      activationReasons: ['anchor:path-match', 'task:#auth'],
      importance: 0.88,
      confidence: 0.94,
      freshness: 0.79,
      persistence: 'long_lived',
    }],
    injectedIds: injected ? ['mem_auth_contract'] : [],
    rejected: { duplicate: 1, belowScore: 2, alreadyVisible: 0, cooldown: 0, budget: injected ? 0 : 1 },
  };
}

describe('memory activation history card', () => {
  it('renders why a memory was activated and confirms context injection', () => {
    const view = render(React.createElement(Entry, { entry: memoryEntry(true), termWidth: 120 }));
    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(frame).toContain('MEMORY INJECTOR');
    expect(frame).toContain('1 activated → 1 injected');
    expect(frame).toContain('injected mem_auth_contract');
    expect(frame).toContain('anchor:path-match');
    expect(frame).not.toContain('refreshSession rotates');
    expect(frame).not.toContain('confidence');
  });

  it('shows activated-but-budget-rejected memories as not injected', () => {
    const view = render(React.createElement(Entry, { entry: memoryEntry(false), termWidth: 120 }));
    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(frame).toContain('1 activated → 0 injected');
    expect(frame).toContain('budget 1');
  });
});
