import type { HqSnapshot } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import {
  buildFleetTopology,
  FLEET_COLUMN_GAP,
  FLEET_LEAF_H,
  layoutFleetTopology,
  type FleetTopologyNode,
} from '../src/views/fleet-topology.js';

function baseSnapshot(overrides: Partial<HqSnapshot> = {}): HqSnapshot {
  return {
    generatedAt: '2026-07-09T00:00:00.000Z',
    clients: [],
    projects: [],
    sessions: [],
    fleets: [],
    mailboxes: [],
    totals: {
      activeProjects: 0,
      activeClients: 0,
      activeSessions: 0,
      activeSubagents: 0,
      unreadMailboxMessages: 0,
      incompleteMailboxMessages: 0,
      totalCostUsd: 0,
    },
    ...overrides,
  };
}

describe('buildFleetTopology', () => {
  it('renders machine → project → terminal → agent nodes from live session telemetry', () => {
    const topology = buildFleetTopology(
      baseSnapshot({
        machines: [
          {
            machineId: 'machine-1',
            hostname: 'devbox',
            clientCount: 1,
            sessionCount: 1,
            agentCount: 1,
            projectIds: ['proj-1'],
            lastActivityAt: '2026-07-09T00:00:00.000Z',
          },
        ],
        projects: [
          {
            projectId: 'proj-1',
            projectName: 'WrongStack',
            projectRootDisplay: 'D:/Codebox/PROJECTS/WrongStack',
            machineIds: ['machine-1'],
            gitBranch: 'main',
            activeClients: 1,
            activeSessions: 1,
            activeSubagents: 1,
            totalCostUsd: 0.1,
            lastActivityAt: '2026-07-09T00:00:00.000Z',
            status: 'active',
          },
        ],
        liveSessions: [
          {
            sessionId: 'sess-1',
            clientKind: 'tui',
            machineId: 'machine-1',
            hostname: 'devbox',
            projectId: 'proj-1',
            projectName: 'WrongStack',
            projectRoot: 'D:/Codebox/PROJECTS/WrongStack',
            gitBranch: 'main',
            status: 'active',
            startedAt: '2026-07-09T00:00:00.000Z',
            lastActivityAt: '2026-07-09T00:01:00.000Z',
            agentCount: 1,
            agents: [
              {
                id: 'agent-1',
                name: 'AMK Agent',
                status: 'running',
                iterations: 2,
                toolCalls: 3,
                currentTool: 'read',
                lastActivityAt: '2026-07-09T00:01:00.000Z',
              },
            ],
          },
        ],
      }),
    );

    expect(topology.nodes.map((n) => `${n.kind}:${n.label}`)).toContain('machine:devbox');
    expect(topology.nodes.map((n) => `${n.kind}:${n.label}`)).toContain('project:WrongStack');
    expect(topology.nodes.some((n) => n.kind === 'terminal' && n.sessionId === 'sess-1')).toBe(true);
    expect(topology.nodes.some((n) => n.kind === 'agent' && n.agentId === 'agent-1')).toBe(true);
    expect(topology.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'machine:machine-1->project:machine-1:proj-1',
      'project:machine-1:proj-1->terminal:sess-1',
      'terminal:sess-1->agent:sess-1:agent-1',
    ]);
  });

  it('keeps connected CLI/TUI/WebUI clients visible while waiting for session telemetry', () => {
    const topology = buildFleetTopology(
      baseSnapshot({
        clients: [
          {
            clientId: 'client-1',
            kind: 'webui',
            machineId: 'machine-1',
            hostname: 'devbox',
            connected: true,
            connectedAt: '2026-07-09T00:00:00.000Z',
            lastSeenAt: '2026-07-09T00:00:10.000Z',
            projectId: 'proj-1',
            capabilities: ['control.receive'],
          },
        ],
        projects: [
          {
            projectId: 'proj-1',
            projectName: 'WrongStack',
            projectRootDisplay: 'D:/Codebox/PROJECTS/WrongStack',
            machineIds: ['machine-1'],
            activeClients: 1,
            activeSessions: 0,
            activeSubagents: 0,
            totalCostUsd: 0,
            lastActivityAt: '2026-07-09T00:00:10.000Z',
            status: 'idle',
          },
        ],
      }),
    );

    const terminal = topology.nodes.find((n) => n.kind === 'terminal');
    expect(terminal?.sessionId).toBe('client:client-1');
    expect(terminal?.clientKind).toBe('webui');
    expect(terminal?.sub).toBe('waiting for session telemetry');
    expect(topology.edges.map((e) => e.target)).toContain('terminal:client:client-1');
  });
});

describe('layoutFleetTopology', () => {
  /** Minimal topology nodes — layout only reads kind/id/machineId/projectId/sessionId. */
  const N = (
    kind: FleetTopologyNode['kind'],
    id: string,
    rest: Partial<FleetTopologyNode> = {},
  ): FleetTopologyNode => ({ id, kind, label: id, chips: [], ...rest });

  const fleet: FleetTopologyNode[] = [
    N('machine', 'machine:m1', { machineId: 'm1' }),
    N('machine', 'machine:m2', { machineId: 'm2' }),
    N('project', 'project:m1:p1', { machineId: 'm1', projectId: 'p1' }),
    N('project', 'project:m2:p2', { machineId: 'm2', projectId: 'p2' }),
    N('terminal', 'terminal:s1', { machineId: 'm1', projectId: 'p1', sessionId: 's1' }),
    N('terminal', 'terminal:s2', { machineId: 'm1', projectId: 'p1', sessionId: 's2' }),
    N('terminal', 'terminal:s3', { machineId: 'm2', projectId: 'p2', sessionId: 's3' }),
    N('agent', 'agent:s1:a1', { machineId: 'm1', projectId: 'p1', sessionId: 's1', agentId: 'a1' }),
    N('agent', 'agent:s1:a2', { machineId: 'm1', projectId: 'p1', sessionId: 's1', agentId: 'a2' }),
    N('agent', 'agent:s1:a3', { machineId: 'm1', projectId: 'p1', sessionId: 's1', agentId: 'a3' }),
  ];

  it('assigns each kind to its own column', () => {
    const pos = layoutFleetTopology(fleet);
    expect(pos.get('machine:m1')?.x).toBe(0);
    expect(pos.get('project:m1:p1')?.x).toBe(FLEET_COLUMN_GAP);
    expect(pos.get('terminal:s1')?.x).toBe(FLEET_COLUMN_GAP * 2);
    expect(pos.get('agent:s1:a1')?.x).toBe(FLEET_COLUMN_GAP * 3);
  });

  it('centers each parent over its own children', () => {
    const pos = layoutFleetTopology(fleet);
    const a1 = pos.get('agent:s1:a1')!.y;
    const a3 = pos.get('agent:s1:a3')!.y;
    expect(pos.get('terminal:s1')?.y).toBe((a1 + a3) / 2);
    const t1 = pos.get('terminal:s1')!.y;
    const t2 = pos.get('terminal:s2')!.y;
    expect(pos.get('project:m1:p1')?.y).toBe((t1 + t2) / 2);
    expect(pos.get('machine:m1')?.y).toBe(pos.get('project:m1:p1')?.y);
  });

  it('keeps machine groups vertically disjoint (no cross-machine interleaving)', () => {
    const pos = layoutFleetTopology(fleet);
    const m1Ys = [...pos.entries()]
      .filter(([id]) => id.includes('m1') || id.includes('s1') || id.includes('s2'))
      .map(([, p]) => p.y);
    const m2Ys = [...pos.entries()]
      .filter(([id]) => id.includes('m2') || id.includes('s3'))
      .map(([, p]) => p.y);
    expect(Math.max(...m1Ys)).toBeLessThan(Math.min(...m2Ys));
  });

  it('never overlaps two nodes in the same column', () => {
    const pos = layoutFleetTopology(fleet);
    const byColumn = new Map<number, number[]>();
    for (const p of pos.values()) {
      const list = byColumn.get(p.x) ?? [];
      list.push(p.y);
      byColumn.set(p.x, list);
    }
    for (const ys of byColumn.values()) {
      const sorted = [...ys].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(FLEET_LEAF_H / 2);
      }
    }
  });

  it('gives lonely machines and empty projects their own slot', () => {
    const pos = layoutFleetTopology([
      N('machine', 'machine:solo', { machineId: 'solo' }),
      N('machine', 'machine:m1', { machineId: 'm1' }),
      N('project', 'project:m1:p1', { machineId: 'm1', projectId: 'p1' }),
    ]);
    expect(pos.get('machine:solo')).toBeDefined();
    expect(pos.get('machine:m1')?.y).not.toBe(pos.get('machine:solo')?.y);
    expect(pos.get('project:m1:p1')).toBeDefined();
  });
});

describe('buildFleetTopology — edge cases', () => {
  it('returns empty nodes/edges for null snapshot', () => {
    const topology = buildFleetTopology(null);
    expect(topology.nodes).toEqual([]);
    expect(topology.edges).toEqual([]);
  });

  it('sorts sessions by secondary keys when machines match', () => {
    // Two sessions on the same machine but different projects:
    // the sort comparator reaches the projectName and sessionId branches.
    const topology = buildFleetTopology(
      baseSnapshot({
        liveSessions: [
          {
            sessionId: 'sess-b',
            clientKind: 'tui',
            machineId: 'machine-1',
            projectId: 'proj-a',
            projectName: 'Alpha',
            status: 'active',
            startedAt: '2026-07-09T00:00:00.000Z',
            lastActivityAt: '2026-07-09T00:01:00.000Z',
            agentCount: 0,
            agents: [],
          },
          {
            sessionId: 'sess-a',
            clientKind: 'cli',
            machineId: 'machine-1',
            projectId: 'proj-b',
            projectName: 'Beta',
            status: 'active',
            startedAt: '2026-07-09T00:00:00.000Z',
            lastActivityAt: '2026-07-09T00:01:00.000Z',
            agentCount: 0,
            agents: [],
          },
        ],
        machines: [{
          machineId: 'machine-1',
          hostname: 'devbox',
          clientCount: 1,
          sessionCount: 2,
          agentCount: 0,
          projectIds: ['proj-a', 'proj-b'],
          lastActivityAt: '2026-07-09T00:01:00.000Z',
        }],
      }),
    );
    // Both sessions share one machine, so the sort must break ties by
    // projectName → projectId. The sort output isn't directly surfaced,
    // but the node list should contain both terminals without error.
    expect(topology.nodes.filter((n) => n.kind === 'terminal')).toHaveLength(2);
    expect(topology.nodes.filter((n) => n.kind === 'project')).toHaveLength(2);
  });

  it('falls back to session.projectName/projectRoot when no project record exists', () => {
    // No snapshot.projects entry for the session's projectId —
    // the labels/chips must use the session-level fallback.
    const topology = buildFleetTopology(
      baseSnapshot({
        liveSessions: [{
          sessionId: 'sess-1',
          clientKind: 'tui',
          machineId: 'machine-1',
          hostname: 'devbox',
          projectId: 'orphan-proj',
          projectName: 'Orphan',
          projectRoot: '/tmp/orphan',
          status: 'active',
          startedAt: '2026-07-09T00:00:00.000Z',
          lastActivityAt: '2026-07-09T00:01:00.000Z',
          agentCount: 0,
          agents: [],
        }],
        machines: [{
          machineId: 'machine-1',
          hostname: 'devbox',
          clientCount: 1,
          sessionCount: 1,
          agentCount: 0,
          projectIds: ['orphan-proj'],
          lastActivityAt: '2026-07-09T00:01:00.000Z',
        }],
      }),
    );
    const project = topology.nodes.find((n) => n.kind === 'project');
    // Since there's no project record, the session's projectName is used.
    expect(project?.label).toBe('Orphan');
    // chips should not crash even without project record fields.
    expect(project?.chips).toBeDefined();
  });

  it('excludes disconnected clients from the topology', () => {
    const topology = buildFleetTopology(
      baseSnapshot({
        clients: [{
          clientId: 'offline-client',
          kind: 'webui',
          machineId: 'machine-x',
          connected: false,
          connectedAt: '2026-07-09T00:00:00.000Z',
          lastSeenAt: '2026-07-09T00:00:10.000Z',
          projectId: 'proj-x',
          capabilities: ['control.receive'],
        }],
      }),
    );
    // Disconnected client should not appear as a node.
    expect(topology.nodes).toHaveLength(0);
  });
});
