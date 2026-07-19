import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryInjectorTrace } from '../../src/components/MemoryManager/MemoryInjectorTrace.js';
import { useMemoryInjectorTraceStore } from '../../src/stores/memory-injector-store.js';

beforeEach(() => useMemoryInjectorTraceStore.getState().clear());
afterEach(cleanup);

describe('MemoryInjectorTrace', () => {
  it('shows activation evidence, memory health, and final injection state', () => {
    useMemoryInjectorTraceStore.getState().pushTrace({
      runId: 'run_1',
      at: '2026-07-19T16:00:00.000Z',
      outcome: 'injected',
      trigger: 'read',
      toolName: 'read',
      queryPreview: 'session refresh auth',
      paths: ['src/auth/session.ts'],
      taskSignals: ['Refactor auth refresh flow'],
      contextPressure: 0.42,
      budget: { maxHints: 8, maxChars: 2800 },
      candidates: 12,
      eligible: 1,
      rejected: { duplicate: 1, belowScore: 7, alreadyVisible: 2, cooldown: 1, budget: 0 },
      activated: [{
        id: 'mem_auth_contract',
        kind: 'symbol_note',
        text: 'refreshSession rotates refresh tokens.',
        score: 0.93,
        relationStrength: 0.95,
        anchor: 'symbol:refreshSession',
        anchors: ['symbol:src/auth/session.ts#refreshSession'],
        tags: ['auth', 'refresh-token'],
        activationReasons: ['anchor:path-match', 'task:#auth'],
        importance: 0.88,
        confidence: 0.94,
        freshness: 0.79,
        persistence: 'long_lived',
      }],
      injected: [{
        id: 'mem_auth_contract',
        kind: 'symbol_note',
        text: 'refreshSession rotates refresh tokens.',
        score: 0.93,
        relationStrength: 0.95,
        anchor: 'symbol:refreshSession',
        anchors: ['symbol:src/auth/session.ts#refreshSession'],
        tags: ['auth', 'refresh-token'],
        activationReasons: ['anchor:path-match', 'task:#auth'],
        importance: 0.88,
        confidence: 0.94,
        freshness: 0.79,
        persistence: 'long_lived',
      }],
      injectedChars: 420,
    });

    render(<MemoryInjectorTrace />);

    expect(screen.getByText('activated')).toBeTruthy();
    expect(screen.getByText('injected to context')).toBeTruthy();
    expect(screen.getByText('Why activated')).toBeTruthy();
    expect(screen.getByText('anchor:path-match')).toBeTruthy();
    expect(screen.getByText('#refresh-token')).toBeTruthy();
    expect(screen.getByText('confidence')).toBeTruthy();
    expect(screen.getByText('freshness')).toBeTruthy();
    expect(screen.getByText('Why activated').closest('details')?.open).toBe(false);
  });
});
