import { afterEach, describe, expect, it } from 'vitest';
import { useAutoPhaseStore } from '../../src/stores/autophase-store';

describe('auto phase store', () => {
  afterEach(() => {
    useAutoPhaseStore.setState({
      phases: [],
      activePhaseId: null,
      overallPercent: 0,
      autonomous: false,
      title: null,
      status: 'idle',
      lastEvent: null,
      lastError: null,
      progress: null,
    });
  });

  it('setState patches each field individually', () => {
    useAutoPhaseStore.getState().setState({ phases: [{ id: 'p1', label: 'Thinking', status: 'active' }] });
    expect(useAutoPhaseStore.getState().phases).toHaveLength(1);
  });

  it('setState preserves unspecified fields', () => {
    useAutoPhaseStore.setState({ phases: [{ id: 'p1', label: 'Thinking', status: 'active' }], autonomous: true });
    useAutoPhaseStore.getState().setState({ title: 'My Title', status: 'running' });
    // autonomous should still be true (not reset)
    expect(useAutoPhaseStore.getState().title).toBe('My Title');
    expect(useAutoPhaseStore.getState().autonomous).toBe(true);
    expect(useAutoPhaseStore.getState().status).toBe('running');
  });

  it('stores lifecycle and progress metadata', () => {
    useAutoPhaseStore.getState().setState({
      status: 'running',
      lastEvent: 'progress',
      progress: { totalPhases: 4, completed: 2, failed: 0, totalTasks: 8, completedTasks: 3, failedTasks: 0 },
    });
    const s = useAutoPhaseStore.getState();
    expect(s.status).toBe('running');
    expect(s.lastEvent).toBe('progress');
    expect(s.progress?.completedTasks).toBe(3);
  });

  it('clear resets all fields', () => {
    useAutoPhaseStore.setState({
      phases: [{ id: 'p1', label: 'Thinking', status: 'active' }],
      activePhaseId: 'p1',
      overallPercent: 50,
      autonomous: true,
      title: 'Test',
      status: 'failed',
      lastEvent: 'failed',
      lastError: 'boom',
      progress: { totalPhases: 1, completed: 0, failed: 1, totalTasks: 2, completedTasks: 1, failedTasks: 1 },
    });
    useAutoPhaseStore.getState().clear();
    const s = useAutoPhaseStore.getState();
    expect(s.phases).toEqual([]);
    expect(s.activePhaseId).toBeNull();
    expect(s.overallPercent).toBe(0);
    expect(s.autonomous).toBe(false);
    expect(s.title).toBeNull();
    expect(s.status).toBe('idle');
    expect(s.lastEvent).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.progress).toBeNull();
  });
});
