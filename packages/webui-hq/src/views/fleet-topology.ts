import type {
  HqClientRecord,
  HqMachineRecord,
  HqProjectRecord,
  HqSessionAgentSummary,
  HqSessionSnapshotPayload,
  HqSnapshot,
} from '@wrongstack/core';

export type FleetTopologyNodeKind = 'machine' | 'project' | 'terminal' | 'agent';

export interface FleetTopologyNode extends Record<string, unknown> {
  id: string;
  kind: FleetTopologyNodeKind;
  label: string;
  sub?: string;
  status?: string;
  chips: string[];
  machineId?: string;
  projectId?: string;
  clientId?: string;
  sessionId?: string;
  agentId?: string;
  clientKind?: string;
  agent?: HqSessionAgentSummary;
  session?: HqSessionSnapshotPayload;
  isSyntheticSession?: boolean;
}

export interface FleetTopologyEdge {
  id: string;
  source: string;
  target: string;
}

export interface FleetTopology {
  nodes: FleetTopologyNode[];
  edges: FleetTopologyEdge[];
}

function machineKey(machineId: string): string {
  return `machine:${machineId}`;
}

function projectKey(machineId: string, projectId: string): string {
  return `project:${machineId}:${projectId}`;
}

function terminalKey(sessionId: string): string {
  return `terminal:${sessionId}`;
}

function agentKey(sessionId: string, agentId: string): string {
  return `agent:${sessionId}:${agentId}`;
}

function addEdge(edges: FleetTopologyEdge[], seen: Set<string>, source: string, target: string): void {
  const id = `${source}->${target}`;
  if (seen.has(id)) return;
  seen.add(id);
  edges.push({ id, source, target });
}

function projectLabel(project: HqProjectRecord | undefined, session?: HqSessionSnapshotPayload): string {
  return project?.projectName ?? session?.projectName ?? 'unknown project';
}

function projectSub(project: HqProjectRecord | undefined, session?: HqSessionSnapshotPayload): string | undefined {
  const root = project?.projectRootDisplay ?? session?.projectRoot;
  if (root === undefined || root.length === 0) return undefined;
  return root.length > 54 ? `…${root.slice(-51)}` : root;
}

function terminalLabel(session: HqSessionSnapshotPayload): string {
  return `${session.clientKind.toUpperCase()} · ${session.sessionId.length > 18 ? `…${session.sessionId.slice(-14)}` : session.sessionId}`;
}

function syntheticSessionFromClient(client: HqClientRecord, project: HqProjectRecord | undefined): HqSessionSnapshotPayload {
  const sessionId = client.sessionId ?? `client:${client.clientId}`;
  return {
    sessionId,
    clientKind: client.kind,
    machineId: client.machineId,
    ...(client.hostname !== undefined ? { hostname: client.hostname } : {}),
    ...(client.pid !== undefined ? { pid: client.pid } : {}),
    projectId: client.projectId,
    projectName: project?.projectName ?? client.projectId,
    projectRoot: project?.projectRootDisplay ?? '',
    ...(project?.gitBranch !== undefined ? { gitBranch: project.gitBranch } : {}),
    status: client.connected ? 'idle' : 'stale',
    startedAt: client.connectedAt ?? client.lastSeenAt,
    lastActivityAt: client.lastSeenAt,
    agentCount: 0,
    agents: [],
  };
}

function machineRecordFor(
  machineId: string,
  machines: Map<string, HqMachineRecord>,
  sessions: readonly HqSessionSnapshotPayload[],
  clients: readonly HqClientRecord[],
): { label: string; sub: string; chips: string[] } {
  const machine = machines.get(machineId);
  const session = sessions.find((s) => s.machineId === machineId);
  const client = clients.find((c) => c.machineId === machineId);
  const label = machine?.hostname ?? session?.hostname ?? client?.hostname ?? machineId;
  const sessionCount = machine?.sessionCount ?? sessions.filter((s) => s.machineId === machineId).length;
  const agentCount = machine?.agentCount ?? sessions.reduce((sum, s) => sum + (s.machineId === machineId ? s.agents.length : 0), 0);
  const clientCount = machine?.clientCount ?? clients.filter((c) => c.machineId === machineId && c.connected).length;
  return {
    label,
    sub: machineId,
    chips: [`${clientCount} client${clientCount === 1 ? '' : 's'}`, `${sessionCount} terminal${sessionCount === 1 ? '' : 's'}`, `${agentCount} agent${agentCount === 1 ? '' : 's'}`],
  };
}

export function buildFleetTopology(snapshot: HqSnapshot | null): FleetTopology {
  if (snapshot === null) return { nodes: [], edges: [] };

  const nodes: FleetTopologyNode[] = [];
  const edges: FleetTopologyEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  const machines = new Map((snapshot.machines ?? []).map((m) => [m.machineId, m]));
  const projects = new Map((snapshot.projects ?? []).map((p) => [p.projectId, p]));
  const liveSessions = [...(snapshot.liveSessions ?? [])];
  const liveSessionIds = new Set(liveSessions.map((s) => s.sessionId));

  for (const client of snapshot.clients ?? []) {
    if (!client.connected) continue;
    const sessionId = client.sessionId ?? `client:${client.clientId}`;
    if (liveSessionIds.has(sessionId)) continue;
    liveSessions.push(syntheticSessionFromClient(client, projects.get(client.projectId)));
    liveSessionIds.add(sessionId);
  }

  const machineIds = new Set<string>();
  for (const machine of snapshot.machines ?? []) machineIds.add(machine.machineId);
  for (const session of liveSessions) machineIds.add(session.machineId);
  for (const client of snapshot.clients ?? []) {
    if (client.connected) machineIds.add(client.machineId);
  }

  for (const machineId of machineIds) {
    const id = machineKey(machineId);
    const record = machineRecordFor(machineId, machines, liveSessions, snapshot.clients ?? []);
    nodes.push({ id, kind: 'machine', label: record.label, sub: record.sub, chips: record.chips, machineId });
    nodeIds.add(id);
  }

  const sortedSessions = liveSessions.sort((a, b) => {
    const machineCompare = a.machineId.localeCompare(b.machineId);
    if (machineCompare !== 0) return machineCompare;
    const projectCompare = a.projectName.localeCompare(b.projectName);
    if (projectCompare !== 0) return projectCompare;
    return a.sessionId.localeCompare(b.sessionId);
  });

  for (const session of sortedSessions) {
    const machineId = session.machineId;
    const project = projects.get(session.projectId);
    const pId = projectKey(machineId, session.projectId);
    if (!nodeIds.has(pId)) {
      const chips = [
        `${project?.activeClients ?? sortedSessions.filter((s) => s.machineId === machineId && s.projectId === session.projectId).length} client${(project?.activeClients ?? 0) === 1 ? '' : 's'}`,
        `${project?.activeSessions ?? sortedSessions.filter((s) => s.machineId === machineId && s.projectId === session.projectId).length} terminal${(project?.activeSessions ?? 0) === 1 ? '' : 's'}`,
      ];
      if (project?.gitBranch !== undefined) chips.push(project.gitBranch);
      nodes.push({
        id: pId,
        kind: 'project',
        label: projectLabel(project, session),
        sub: projectSub(project, session),
        status: project?.status ?? session.status,
        chips,
        machineId,
        projectId: session.projectId,
      });
      nodeIds.add(pId);
    }
    addEdge(edges, edgeIds, machineKey(machineId), pId);

    const tId = terminalKey(session.sessionId);
    if (!nodeIds.has(tId)) {
      const isSynthetic = session.sessionId.startsWith('client:') && session.agents.length === 0;
      const chips = [session.clientKind, session.status, `${session.agentCount} agent${session.agentCount === 1 ? '' : 's'}`];
      if (session.gitBranch !== undefined) chips.push(session.gitBranch);
      nodes.push({
        id: tId,
        kind: 'terminal',
        label: terminalLabel(session),
        sub: isSynthetic ? 'waiting for session telemetry' : session.projectName,
        status: session.status,
        chips,
        machineId,
        projectId: session.projectId,
        sessionId: session.sessionId,
        clientKind: session.clientKind,
        session,
        isSyntheticSession: isSynthetic,
      });
      nodeIds.add(tId);
    }
    addEdge(edges, edgeIds, pId, tId);

    for (const agent of session.agents) {
      const aId = agentKey(session.sessionId, agent.id);
      nodes.push({
        id: aId,
        kind: 'agent',
        label: agent.name || agent.id,
        sub: agent.currentTool ?? agent.partialText,
        status: agent.status,
        chips: [
          agent.status,
          `${agent.iterations} iter`,
          `${agent.toolCalls} tools`,
          ...(agent.model !== undefined ? [agent.model] : []),
        ],
        machineId,
        projectId: session.projectId,
        sessionId: session.sessionId,
        agentId: agent.id,
        agent,
        session,
      });
      addEdge(edges, edgeIds, tId, aId);
    }
  }

  return { nodes, edges };
}
