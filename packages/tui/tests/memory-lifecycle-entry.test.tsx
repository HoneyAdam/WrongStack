import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { Entry, type HistoryEntry } from '../src/components/history.js';
import { memoryLifecycleEntry } from '../src/memory-lifecycle-entry.js';

describe('memory lifecycle timeline', () => {
  it('formats and renders a grounded relationship event compactly', () => {
    const lifecycle = memoryLifecycleEntry('memory.graph_edge_added', {
      from: 'mem:mem_auth_contract',
      to: 'mem:mem_refresh_workflow',
      relation: 'same_topic',
      evidence: ['tag:refresh-token'],
    });
    expect(lifecycle).not.toBeNull();

    const entry: HistoryEntry = { id: 1, kind: 'memory-lifecycle', ...lifecycle! };
    const view = render(React.createElement(Entry, { entry, termWidth: 120 }));
    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(frame).toContain('MEMORY');
    expect(frame).toContain('mem_auth_contract');
    expect(frame).toContain('same_topic');
    expect(frame).toContain('why: tag:refresh-token');
  });

  it('keeps non-memory graph scaffolding out of the TUI timeline', () => {
    expect(
      memoryLifecycleEntry('memory.graph_edge_added', {
        from: 'file:src/auth.ts',
        to: 'dir:src',
        relation: 'related_to',
      }),
    ).toBeNull();
  });
});
