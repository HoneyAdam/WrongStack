import type { HqSnapshot } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import { buildFleetTopology } from '../src/views/fleet-topology.js';

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
