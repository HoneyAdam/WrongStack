import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextMemoryMonitor } from '../../src/components/ContextMemoryMonitor.js';
import { useMemoryInjectorTraceStore } from '../../src/stores/memory-injector-store.js';
import { memoryTrace } from '../fixtures/memory-trace.js';

beforeEach(() => useMemoryInjectorTraceStore.getState().clear());
afterEach(cleanup);

describe('ContextMemoryMonitor', () => {
  it('shows full evidence and exact came/went transitions outside the summary widget', () => {
    const store = useMemoryInjectorTraceStore.getState();
    store.pushTrace(memoryTrace());
    store.applyContextSnapshot({
      at: '2026-07-19T16:00:01.000Z',
      activeMemoryIds: ['mem_auth_contract'],
      enteredMemoryIds: ['mem_auth_contract'],
      exitedMemoryIds: [],
    });
    store.applyContextSnapshot({
      at: '2026-07-19T16:00:02.000Z',
      activeMemoryIds: [],
      enteredMemoryIds: [],
      exitedMemoryIds: ['mem_auth_contract'],
    });

    render(<ContextMemoryMonitor />);

    expect(screen.getByText('refreshSession rotates refresh tokens.')).toBeTruthy();
    expect(screen.getByText(/why: anchor:path-match/)).toBeTruthy();
    expect(screen.getAllByText(/score 0.93/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('exited').length).toBeGreaterThan(0);
    expect(screen.getByText('0 ctx')).toBeTruthy();
    expect(screen.getByText('0 pending')).toBeTruthy();
    expect(screen.getByText('1 left')).toBeTruthy();
  });

  it('does not erase provider-confirmed context state when the same memory is reinjected', () => {
    const store = useMemoryInjectorTraceStore.getState();
    store.pushTrace(memoryTrace());
    store.applyContextSnapshot({
      at: '2026-07-19T16:00:01.000Z',
      activeMemoryIds: ['mem_auth_contract'],
      enteredMemoryIds: ['mem_auth_contract'],
      exitedMemoryIds: [],
    });
    store.pushTrace({ ...memoryTrace(), runId: 'run_reinject', at: '2026-07-19T16:00:02.000Z' });

    render(<ContextMemoryMonitor />);

    expect(screen.getByText('1 ctx')).toBeTruthy();
    expect(screen.getByText('0 pending')).toBeTruthy();
  });
});
