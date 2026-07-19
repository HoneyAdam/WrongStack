/**
 * HQ server — snapshot builders for browser push and HTTP API responses.
 *
 * @module hq-server/snapshot
 */

import type {
  HqBrowserMessage,
  HqClientCapability,
  HqClientRecord,
  HqCommandAuditEntry,
  HqEventEnvelope,
  HqFleetSnapshotPayload,
  HqFleetSummary,
  HqMachineRecord,
  HqMailboxSnapshotPayload,
  HqMailboxSummary,
  HqMcpServerHealth,
  HqPersistence,
  HqProjectRecord,
  HqSessionSnapshotPayload,
  HqSessionSummary,
  HqSnapshot,
} from '@wrongstack/core';
import { WebSocket } from 'ws';
import type { ConnectedClient, HqSnapshotBroadcaster, ProjectDetail } from './types.js';
import { hqMachineKey } from './utils.js';

// ── Broadcast debounce ─────────────────────────────────────────────────────

export const HQ_SNAPSHOT_BROADCAST_DEBOUNCE_MS = 100;

// ── buildSnapshot ──────────────────────────────────────────────────────────

export function buildSnapshot(
  clients: Map<WebSocket, ConnectedClient>,
  options?: { tokenStats?: HqSnapshot['totals']['tokenStats'] },
): HqSnapshot {
  const now = new Date().toISOString();
  // Dedupe client records by clientId — one process may hold two sockets (a
  // mailbox publisher + a telemetry publisher) sharing the same clientId.
  const clientRecordById = new Map<string, HqClientRecord>();
  const projectMap = new Map<string, HqProjectRecord>();
  const mailboxSummaries: HqMailboxSummary[] = [];
  // Live sessions, deduped by sessionId across sockets (latest wins).
  const sessionById = new Map<string, HqSessionSnapshotPayload>();
  // Fleet snapshots, deduped by runId across sockets (latest wins).
  const fleetByRunId = new Map<
    string,
    { payload: HqFleetSnapshotPayload; clientId: string; projectId: string; lastActivityAt: string }
  >();

  for (const client of clients.values()) {
    const machineId = client.machineId || client.project.machineId || '';
    if (!clientRecordById.has(client.clientId)) {
      clientRecordById.set(client.clientId, {
        clientId: client.clientId,
        kind: client.kind as HqClientRecord['kind'],
        machineId,
        ...(client.hostname ? { hostname: client.hostname } : {}),
        ...(client.pid ? { pid: client.pid } : {}),
        ...(client.version ? { version: client.version } : {}),
        connected: true,
        connectedAt: client.connectedAt,
        lastSeenAt: client.lastSeenAt,
        projectId: client.projectId,
        capabilities: client.capabilities as readonly HqClientCapability[],
      });
    }

    let project = projectMap.get(client.projectId);
    if (!project) {
      project = {
        projectId: client.projectId,
        projectName: client.project.projectName || client.projectId,
        projectRootDisplay: client.project.projectRoot,
        machineIds: [machineId],
        ...(client.project.gitBranch ? { gitBranch: client.project.gitBranch } : {}),
        activeClients: 0,
        activeSessions: 0,
        activeSubagents: 0,
        totalCostUsd: 0,
        lastActivityAt: now,
        status: 'active',
      };
      projectMap.set(client.projectId, project);
    } else if (machineId && !project.machineIds.includes(machineId)) {
      project.machineIds = [...project.machineIds, machineId];
    }

    for (const tracked of client.sessions.values()) {
      const cutoff = Date.now() - 5 * 60_000;
      const agents = tracked.payload.agents.filter((agent) => {
        if (agent.id === 'leader') return true;
        const lastActivityAt = Date.parse(agent.lastActivityAt);
        return Number.isFinite(lastActivityAt) && lastActivityAt >= cutoff;
      });
      sessionById.set(tracked.payload.sessionId, {
        ...tracked.payload,
        clientId: client.clientId,
        agents,
        agentCount: agents.length,
      });
    }

    for (const snapshot of client.mailboxes.values()) {
      mailboxSummaries.push({
        mailboxId: snapshot.mailboxId,
        projectId: client.projectId,
        scope: snapshot.scope,
        messageCount: snapshot.totals.messages,
        unreadCount: snapshot.totals.unread,
        incompleteCount: snapshot.totals.incomplete,
        highPriorityCount: snapshot.totals.highPriority,
        onlineAgentCount: snapshot.totals.onlineAgents,
        lastActivityAt: now,
      });
    }

    // Collect fleet snapshots — latest per runId wins.
    for (const fleet of client.fleets.values()) {
      fleetByRunId.set(fleet.payload.runId, {
        payload: fleet.payload,
        clientId: client.clientId,
        projectId: client.projectId,
        lastActivityAt: new Date(fleet.receivedAt).toISOString(),
      });
    }
  }

  // One PROCESS = one client. A single wstack process legitimately holds
  // several publisher sockets (session telemetry + mailbox + webui), so
  // counting client records would inflate every client counter 2-3×.
  const processKeyOf = (rec: HqClientRecord): string =>
    rec.pid !== undefined ? `${rec.machineId}:${rec.pid}` : rec.clientId;

  // Per-project active-client counts — distinct processes per project.
  const countedProjectProcesses = new Set<string>();
  for (const rec of clientRecordById.values()) {
    const key = `${rec.projectId}|${processKeyOf(rec)}`;
    if (countedProjectProcesses.has(key)) continue;
    countedProjectProcesses.add(key);
    const project = projectMap.get(rec.projectId);
    if (project) project.activeClients++;
  }

  // Fold live sessions into projects + machines.
  const liveSessions = Array.from(sessionById.values());
  const machineMap = new Map<string, { record: HqMachineRecord; projects: Set<string> }>();
  let totalAgents = 0;
  let totalSubagents = 0;
  let totalCostUsd = 0;

  for (const session of liveSessions) {
    // Ensure the project exists even if only a session (no mailbox/client
    // record under this projectId yet) reported it.
    let project = projectMap.get(session.projectId);
    if (!project) {
      project = {
        projectId: session.projectId,
        projectName: session.projectName || session.projectId,
        projectRootDisplay: session.projectRoot,
        machineIds: [session.machineId],
        ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
        activeClients: 0,
        activeSessions: 0,
        activeSubagents: 0,
        totalCostUsd: 0,
        lastActivityAt: session.lastActivityAt,
        status: 'active',
      };
      projectMap.set(session.projectId, project);
    } else if (session.machineId && !project.machineIds.includes(session.machineId)) {
      project.machineIds = [...project.machineIds, session.machineId];
    }
    project.activeSessions++;

    let sessionCost = 0;
    for (const agent of session.agents) {
      totalAgents++;
      if (agent.id !== 'leader') totalSubagents++;
      if (typeof agent.costUsd === 'number') {
        sessionCost += agent.costUsd;
      }
    }
    project.activeSubagents += session.agents.filter((a) => a.id !== 'leader').length;
    project.totalCostUsd += sessionCost;
    totalCostUsd += sessionCost;

    // Machine aggregation — keyed by hostname so the SAME computer is one
    // machine even when clients report different per-process machineIds.
    const mKey = hqMachineKey(session.hostname, session.machineId);
    let machine = machineMap.get(mKey);
    if (!machine) {
      machine = {
        record: {
          machineId: session.machineId,
          ...(session.hostname ? { hostname: session.hostname } : {}),
          clientCount: 0,
          sessionCount: 0,
          agentCount: 0,
          projectIds: [],
          lastActivityAt: session.lastActivityAt,
        },
        projects: new Set<string>(),
      };
      machineMap.set(mKey, machine);
    }
    machine.record.sessionCount++;
    machine.record.agentCount += session.agents.length;
    machine.projects.add(session.projectId);
    if (session.lastActivityAt > machine.record.lastActivityAt) {
      machine.record.lastActivityAt = session.lastActivityAt;
    }
  }

  // Attribute connected clients to machines too (so a machine with a client
  // but no session yet still appears). clientCount is per PROCESS, not per
  // publisher socket — see processKeyOf above.
  const countedMachineProcesses = new Set<string>();
  for (const rec of clientRecordById.values()) {
    if (!rec.machineId && !rec.hostname) continue;
    const rKey = hqMachineKey(rec.hostname, rec.machineId);
    let machine = machineMap.get(rKey);
    if (!machine) {
      machine = {
        record: {
          machineId: rec.machineId,
          ...(rec.hostname ? { hostname: rec.hostname } : {}),
          clientCount: 0,
          sessionCount: 0,
          agentCount: 0,
          projectIds: [],
          lastActivityAt: rec.lastSeenAt,
        },
        projects: new Set<string>(),
      };
      machineMap.set(rKey, machine);
    }
    const processKey = `${rKey}|${processKeyOf(rec)}`;
    if (!countedMachineProcesses.has(processKey)) {
      countedMachineProcesses.add(processKey);
      machine.record.clientCount++;
    }
    machine.projects.add(rec.projectId);
    if (rec.hostname && !machine.record.hostname) machine.record.hostname = rec.hostname;
  }

  const machines: HqMachineRecord[] = Array.from(machineMap.values()).map((m) => ({
    ...m.record,
    projectIds: Array.from(m.projects),
  }));

  const clientRecords = Array.from(clientRecordById.values());
  const projects = Array.from(projectMap.values());

  let unread = 0;
  let incomplete = 0;
  for (const m of mailboxSummaries) {
    unread += m.unreadCount;
    incomplete += m.incompleteCount;
  }

  // Derive session summaries from live sessions (the spine of the fleet tree)
  // so the dashboard's sessions[] rollup is populated alongside liveSessions.
  const sessions: HqSessionSummary[] = liveSessions.map((s) => {
    let sessionCost = 0;
    for (const agent of s.agents) {
      if (typeof agent.costUsd === 'number') sessionCost += agent.costUsd;
    }
    const provider = s.agents.find((a) => a.model !== undefined)?.model;
    return {
      sessionId: s.sessionId,
      projectId: s.projectId,
      clientId: s.clientId ?? `${s.machineId}:${s.clientKind}`,
      status: s.status === 'active' ? 'running' : 'idle',
      ...(provider !== undefined ? { model: provider } : {}),
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      ...(sessionCost > 0 ? { costUsd: sessionCost } : {}),
    };
  });

  // Derive fleet summaries from collected coordinator snapshots so the
  // dashboard's fleets[] rollup reflects every connected machine's fleet.
  const fleets: HqFleetSummary[] = Array.from(fleetByRunId.values()).map((f) => ({
    runId: f.payload.runId,
    projectId: f.projectId,
    clientId: f.clientId,
    activeSubagents: f.payload.activeSubagents,
    queuedTasks: f.payload.queuedTasks,
    completedTasks: f.payload.completedTasks,
    failedTasks: f.payload.failedTasks,
    ...(f.payload.totalCostUsd !== undefined ? { totalCostUsd: f.payload.totalCostUsd } : {}),
    lastActivityAt: f.lastActivityAt,
  }));

  // Collect MCP server health — latest per (client, sessionId, serverName).
  const mcpServers: HqMcpServerHealth[] = [];
  const seenMcp = new Set<string>();
  for (const client of clients.values()) {
    for (const [sessionId, servers] of client.mcpSnapshots.entries()) {
      for (const server of servers) {
        const key = `${client.clientId}:${sessionId}:${server.name}`;
        if (seenMcp.has(key)) continue;
        seenMcp.add(key);
        mcpServers.push(server);
      }
    }
  }

  return {
    generatedAt: now,
    clients: clientRecords,
    projects,
    sessions,
    fleets,
    mailboxes: mailboxSummaries,
    machines,
    liveSessions,
    mcpServers,
    totals: {
      activeProjects: projects.length,
      activeClients: new Set(clientRecords.map(processKeyOf)).size,
      activeSessions: liveSessions.length,
      activeSubagents: totalSubagents,
      unreadMailboxMessages: unread,
      incompleteMailboxMessages: incomplete,
      totalCostUsd,
      activeMachines: machines.length,
      activeAgents: totalAgents,
      ...(options?.tokenStats !== undefined ? { tokenStats: options.tokenStats } : {}),
    },
  };
}

// ── Snapshot broadcaster ───────────────────────────────────────────────────

export function createSnapshotBroadcaster(
  clients: Map<WebSocket, ConnectedClient>,
  browsers: Set<WebSocket>,
  persistence?: HqPersistence,
): HqSnapshotBroadcaster {
  let cached = '';
  let dirty = true;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const serialize = (): string => {
    if (!dirty && cached.length > 0) return cached;
    const snapshot = buildSnapshot(clients);
    const msg: HqBrowserMessage = { type: 'hq.snapshot', snapshot };
    cached = JSON.stringify(msg);
    dirty = false;
    // Persist the snapshot checkpoint (best-effort, fire-and-forget) so a
    // restarted HQ can re-seed its in-memory state from disk.
    if (persistence !== undefined) persistence.snapshotStore.save(snapshot);
    return cached;
  };

  const flush = (): void => {
    timer = null;
    // Always serialize: this also overwrites the persisted checkpoint when the
    // final client disappears, even if no browser is currently connected.
    const data = serialize();
    for (const ws of browsers) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  };

  return {
    currentSerialized: serialize,
    broadcast: () => {
      // Socket close callbacks can arrive after the HQ handle has begun
      // shutting down. Do not let those callbacks recreate the debounce
      // timer and write snapshot.json after close() has already drained it.
      if (closed) return;
      dirty = true;
      if (timer !== null) return;
      timer = setTimeout(flush, HQ_SNAPSHOT_BROADCAST_DEBOUNCE_MS);
      timer.unref?.();
    },
    close: () => {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

// ── Project detail ─────────────────────────────────────────────────────────

export function buildProjectDetail(
  clients: Map<WebSocket, ConnectedClient>,
  projectId: string,
): ProjectDetail | null {
  const projectClients: ConnectedClient[] = [];
  for (const c of clients.values()) {
    if (c.projectId === projectId) projectClients.push(c);
  }
  if (projectClients.length === 0) return null;

  const now = new Date().toISOString();
  const clientRecords: HqClientRecord[] = projectClients.map((c) => ({
    clientId: c.clientId,
    kind: c.kind as HqClientRecord['kind'],
    machineId: '',
    ...(c.hostname ? { hostname: c.hostname } : {}),
    ...(c.pid ? { pid: c.pid } : {}),
    ...(c.version ? { version: c.version } : {}),
    connected: true,
    connectedAt: c.connectedAt,
    lastSeenAt: c.lastSeenAt,
    projectId: c.projectId,
    capabilities: c.capabilities as readonly HqClientCapability[],
  }));

  const mailboxPayloads: HqMailboxSnapshotPayload[] = [];
  let latestActivity = now;
  for (const c of projectClients) {
    for (const snap of c.mailboxes.values()) {
      mailboxPayloads.push(snap);
      if (snap.totals.messages > 0) latestActivity = now;
    }
  }

  const primaryProject = projectClients[0]!.project;
  const machineIds = Array.from(new Set(projectClients.map((client) => client.project.machineId)));
  const project: HqProjectRecord = {
    projectId,
    projectName: primaryProject.projectName || projectId,
    projectRootDisplay: primaryProject.projectRoot,
    machineIds,
    ...(primaryProject.gitBranch ? { gitBranch: primaryProject.gitBranch } : {}),
    activeClients: projectClients.length,
    activeSessions: 0,
    activeSubagents: 0,
    totalCostUsd: 0,
    lastActivityAt: latestActivity,
    status: 'active',
  };

  return {
    generatedAt: now,
    project,
    clients: clientRecords,
    mailboxes: mailboxPayloads,
  };
}

// ── Event broadcast ────────────────────────────────────────────────────────

export function broadcastEvent(event: HqEventEnvelope, browsers: Set<WebSocket>): void {
  const msg: HqBrowserMessage = { type: 'hq.event', event };
  const data = JSON.stringify(msg);
  for (const ws of browsers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

/** Push one control command's lifecycle to every authenticated HQ browser. */
export function broadcastCommandStatus(
  command: HqCommandAuditEntry,
  browsers: Set<WebSocket>,
): void {
  const data = JSON.stringify({ type: 'hq.command_status', command } satisfies HqBrowserMessage);
  for (const ws of browsers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}
