import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryLifecycleTrace } from '../../src/components/MemoryManager/MemoryLifecycleTrace.js';
import {
  toMemoryLifecycleItem,
  useMemoryLifecycleStore,
} from '../../src/stores/memory-lifecycle-store.js';

beforeEach(() => useMemoryLifecycleStore.getState().clear());
afterEach(cleanup);

describe('Memory lifecycle live ledger', () => {
  it('renders entered, exited, and grounded relationship events as compact rows', () => {
    const store = useMemoryLifecycleStore.getState();
    store.pushEvent({
      event: 'memory.accepted',
      memoryId: 'mem_auth',
      kind: 'symbol_note',
      persistence: 'long_lived',
      confidence: 0.94,
      freshness: 0.81,
    });
    store.pushEvent({
      event: 'memory.graph_edge_added',
      from: 'mem:mem_auth',
      to: 'mem:mem_refresh',
      relation: 'same_topic',
      weight: 0.89,
      evidence: ['tag:refresh-token'],
    });
    store.pushEvent({
      event: 'memory.deleted',
      memoryId: 'mem_old',
      reason: 'Superseded by the refresh contract.',
      removedEdges: 2,
    });

    render(<MemoryLifecycleTrace />);

    expect(screen.getByText('mem_auth entered memory')).toBeTruthy();
    expect(screen.getByText('mem_auth ↔ mem_refresh')).toBeTruthy();
    expect(screen.getByTitle(/why: tag:refresh-token/)).toBeTruthy();
    expect(screen.getByText('mem_old exited memory')).toBeTruthy();
  });

  it('coalesces generic deleted updates with the explicit deleted event', () => {
    const store = useMemoryLifecycleStore.getState();
    store.pushEvent({ event: 'memory.updated', memoryId: 'mem_old', status: 'deleted' });
    store.pushEvent({ event: 'memory.deleted', memoryId: 'mem_old', reason: 'Explicit cleanup.' });

    expect(useMemoryLifecycleStore.getState().items).toHaveLength(1);
    expect(useMemoryLifecycleStore.getState().items[0]?.detail).toContain('Explicit cleanup.');
  });

  it('ignores injector events because they have their own compact trace', () => {
    expect(toMemoryLifecycleItem({ event: 'memory.injector_run' })).toBeNull();
  });
});
