import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Capture every WS message the board sends.
const sent: Array<{ type: string }> = [];
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ client: { send: (m: { type: string }) => sent.push(m) } }),
}));
vi.mock('@/hooks/useProviderModels', () => ({ useProviderModels: () => [] }));
// Stub the heavy presentational children so the test stays focused on controls.
vi.mock('@/components/SddFlowGraph', () => ({ SddFlowGraph: () => null }));
vi.mock('@/components/SddKanbanView', () => ({ SddKanbanView: () => null }));
vi.mock('@/components/SddActivityFeed', () => ({ SddActivityFeed: () => null }));
vi.mock('@/components/SddTaskDrawer', () => ({ SddTaskDrawer: () => null }));

import { SddBoardView } from '../../src/components/SddBoardView.js';
import { useSddBoardStore, type SddBoardSnapshotUI } from '../../src/stores/sdd-board-store.js';

function snapshot(over: Partial<SddBoardSnapshotUI> = {}): SddBoardSnapshotUI {
  return {
    runId: 'r1',
    graphId: 'g1',
    title: 'My Run',
    status: 'completed', // not running/paused → lifecycle controls show
    startedAt: 0,
    updatedAt: 0,
    progress: { total: 1, completed: 1, failed: 0, inProgress: 0, pending: 0, blocked: 0, review: 0, percentComplete: 100 },
    wave: 0,
    tasks: [],
    columns: [],
    ...over,
  };
}

afterEach(() => {
  sent.length = 0;
  useSddBoardStore.setState({ snapshot: null });
});

describe('SddBoardView — lifecycle controls', () => {
  it('Clean worktrees sends sdd.board.cleanup_worktrees when the run is stopped', () => {
    useSddBoardStore.setState({ snapshot: snapshot() });
    render(<SddBoardView onClose={() => {}} />);
    fireEvent.click(screen.getByText('Clean worktrees'));
    expect(sent.some((m) => m.type === 'sdd.board.cleanup_worktrees')).toBe(true);
  });

  it('Rollback shows only with merged commits and sends sdd.board.rollback', () => {
    // No merged commits → no Rollback button.
    useSddBoardStore.setState({ snapshot: snapshot() });
    const { rerender } = render(<SddBoardView onClose={() => {}} />);
    expect(screen.queryByText(/Rollback/)).toBeNull();

    useSddBoardStore.setState({
      snapshot: snapshot({ baseBranch: 'main', mergedCommits: [{ taskId: 't', sha: 'abc1234', title: 'x' }] }),
    });
    rerender(<SddBoardView onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Rollback/));
    expect(sent.some((m) => m.type === 'sdd.board.rollback')).toBe(true);
  });

  it('hides lifecycle controls while the run is active', () => {
    useSddBoardStore.setState({ snapshot: snapshot({ status: 'running' }) });
    render(<SddBoardView onClose={() => {}} />);
    expect(screen.queryByText('Clean worktrees')).toBeNull();
  });
});
