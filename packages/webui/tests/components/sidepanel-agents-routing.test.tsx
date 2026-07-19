import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentsPanel } from '../../src/components/SidePanel/AgentsPanel.js';
import {
  selectFleetSummary,
  selectSortedAgentList,
  useFleetStore,
} from '../../src/stores/index.js';

function makeAgent(id: string, overrides: Partial<{ name: string; status: string }> = {}) {
  return {
    id,
    name: overrides.name ?? id,
    status: overrides.status ?? 'running',
    iteration: 0,
    toolCalls: 0,
    costUsd: 0,
    ctxPct: 0,
    ctxTokens: 0,
    maxContext: 0,
    extensions: 0,
    startedAt: Date.now(),
    toolLog: [],
    sparklineBins: Array(12).fill(0),
  } as const;
}

/**
 * Integration-level tests for the AgentsPanel data pipeline.
 *
 * These test the selector chain that AgentsPanel uses:
 *   selectSortedAgentList → selectFleetSummary
 *
 * The selectors are the same ones mounted inside AgentsPanel. Component
 * subscriptions wrap derived array/object results in useShallow so Zustand's
 * useSyncExternalStore snapshot stays reference-stable.
 */

describe('AgentsPanel data routing', () => {
  afterEach(cleanup);

  beforeEach(() => {
    useFleetStore.setState({ agents: new Map() });
  });

  it('selectFleetSummary returns zeros for empty fleet', () => {
    useFleetStore.setState({ agents: new Map() });
    const s = selectFleetSummary(useFleetStore.getState());
    expect(s.running).toBe(0);
    expect(s.total).toBe(0);
  });

  it('selectSortedAgentList returns empty array for empty fleet', () => {
    useFleetStore.setState({ agents: new Map() });
    expect(selectSortedAgentList(useFleetStore.getState())).toEqual([]);
  });

  it('selectSortedAgentList sorts running agents first', () => {
    const agents = new Map();
    agents.set('a1', makeAgent('a1', { name: 'Alpha', status: 'completed' }));
    agents.set('a2', makeAgent('a2', { name: 'Beta', status: 'running' }));
    useFleetStore.setState({ agents });

    const list = selectSortedAgentList(useFleetStore.getState());
    expect(list[0].name).toBe('Beta');
    expect(list[1].name).toBe('Alpha');
  });

  it('selectFleetSummary aggregates mixed-status fleet correctly', () => {
    const agents = new Map();
    agents.set('a1', makeAgent('a1', { name: 'A', status: 'running' }));
    agents.set('a2', makeAgent('a2', { name: 'B', status: 'completed' }));
    agents.set('a3', makeAgent('a3', { name: 'C', status: 'failed' }));
    useFleetStore.setState({ agents });

    const s = selectFleetSummary(useFleetStore.getState());
    expect(s.running).toBe(1);
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.total).toBe(3);
  });

  it('selectFleetSummary totalCost sums across agents', () => {
    const agents = new Map();
    agents.set('a1', { ...makeAgent('a1'), costUsd: 0.1 });
    agents.set('a2', { ...makeAgent('a2'), costUsd: 0.2 });
    useFleetStore.setState({ agents });

    expect(selectFleetSummary(useFleetStore.getState()).totalCost).toBeCloseTo(0.3);
  });

  it('selectSortedAgentList puts leader first regardless of status', () => {
    const agents = new Map();
    agents.set('a1', makeAgent('a1', { name: 'Leader', status: 'completed' }));
    agents.set('a2', makeAgent('a2', { name: 'Worker', status: 'running' }));
    useFleetStore.setState({ agents, leaderId: 'a1' });

    const list = selectSortedAgentList(useFleetStore.getState());
    expect(list[0].name).toBe('Leader');
  });

  it('renders without a maximum-update-depth loop', () => {
    const agents = new Map();
    agents.set('a1', makeAgent('a1', { name: 'Alpha', status: 'running' }));
    useFleetStore.setState({ agents, leaderId: 'a1' });

    render(<AgentsPanel />);

    expect(screen.getAllByText('Alpha')).toHaveLength(2);
  });
});
