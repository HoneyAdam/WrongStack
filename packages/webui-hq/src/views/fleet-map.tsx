/**
 * FleetMap view — machine → project → terminal → agent tree.
 * The spine of the HQ dashboard. Clicking a session opens it in Console.
 */
import type { HqSessionSnapshotPayload } from '@wrongstack/core';
import { Bot, GitBranch, MonitorSmartphone, SquareTerminal } from 'lucide-react';
import type React from 'react';
import { selectSession, setActiveView, useHqStore } from '../store.js';

function agentAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function SessionNode({
  s,
  selected,
}: {
  s: HqSessionSnapshotPayload;
  selected: boolean;
}): React.ReactElement {
  const cost = s.agents.reduce((sum, a) => sum + (a.costUsd ?? 0), 0);
  return (
    <div className="hq-fleet-session">
      <div
        className={`hq-tree-node${selected ? ' sel' : ''}`}
        onClick={() => {
          selectSession(s.sessionId);
          setActiveView('console');
        }}
        title={`${s.sessionId} — open in Console`}
      >
        <SquareTerminal size={13} className="hq-fleet-node-icon" />
        <span className="hq-pill idle">{s.clientKind}</span>
        <span className="hq-mono" style={{ fontWeight: 600 }}>
          {s.projectName}
        </span>
        {s.gitBranch !== undefined && (
          <span className="hq-mono hq-fleet-branch">
            <GitBranch size={11} /> {s.gitBranch}
          </span>
        )}
        <span className={`hq-pill ${s.status === 'active' ? 'active' : 'idle'}`}>{s.status}</span>
        {cost > 0 && <span className="hq-cost-amount">${cost.toFixed(3)}</span>}
      </div>
      {s.agents.map((a) => (
        <div key={a.id} className="hq-tree-node hq-fleet-agent">
          <Bot size={12} className={`hq-fleet-agent-dot ${a.status}`} />
          <span className="hq-mono">{a.name}</span>
          <span className={`hq-pill ${a.status}`}>{a.status}</span>
          {a.model !== undefined && <span className="hq-pill info">{a.model}</span>}
          {a.currentTool !== undefined && (
            <span className="hq-mono hq-fleet-tool">{a.currentTool}</span>
          )}
          <span className="hq-fleet-agent-meta">
            {typeof a.ctxPct === 'number' && (
              <span className="hq-mono hq-row-subtle">ctx {a.ctxPct}%</span>
            )}
            {typeof a.costUsd === 'number' && a.costUsd > 0 && (
              <span className="hq-cost-amount">${a.costUsd.toFixed(3)}</span>
            )}
            <span className="hq-mono hq-row-subtle">{agentAge(a.lastActivityAt)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function FleetMapView(): React.ReactElement {
  const state = useHqStore(['snapshot', 'selectedSessionId']);
  const snap = state.snapshot;

  if (snap === null) {
    return <div className="hq-empty">Waiting for fleet data…</div>;
  }

  const machines = snap.machines ?? [];
  const liveSessions = snap.liveSessions ?? [];

  // Group sessions by machine (hostname key), then by project.
  const byMachine = new Map<string, HqSessionSnapshotPayload[]>();
  for (const s of liveSessions) {
    const key = s.hostname ?? s.machineId;
    const arr = byMachine.get(key) ?? [];
    arr.push(s);
    byMachine.set(key, arr);
  }
  for (const m of machines) {
    const key = m.hostname ?? m.machineId;
    if (!byMachine.has(key)) byMachine.set(key, []);
  }

  return (
    <div>
      <div className="hq-card-title">
        Fleet Topology ({machines.length} machine{machines.length === 1 ? '' : 's'},{' '}
        {liveSessions.length} session{liveSessions.length === 1 ? '' : 's'})
      </div>
      {Array.from(byMachine.entries()).map(([machineKey, sessions]) => {
        const machine = machines.find((m) => (m.hostname ?? m.machineId) === machineKey);
        const machineCost = sessions.reduce(
          (sum, s) => sum + s.agents.reduce((c, a) => c + (a.costUsd ?? 0), 0),
          0,
        );
        const agentCount = sessions.reduce((sum, s) => sum + s.agents.length, 0);
        return (
          <div key={machineKey} className="hq-card">
            <div className="hq-row hq-lane-head">
              <MonitorSmartphone size={15} className="hq-fleet-node-icon" />
              <span style={{ fontWeight: 700 }}>{machine?.hostname ?? machineKey}</span>
              <span className="hq-pill idle">{sessions.length} session(s)</span>
              <span className="hq-pill info">{agentCount} agents</span>
              {machineCost > 0 && <span className="hq-cost-amount">${machineCost.toFixed(3)}</span>}
            </div>
            {sessions.length === 0 ? (
              <div className="hq-row-subtle hq-mono" style={{ padding: '4px 8px' }}>
                connected, no live sessions
              </div>
            ) : (
              sessions.map((s) => (
                <SessionNode
                  key={s.sessionId}
                  s={s}
                  selected={state.selectedSessionId === s.sessionId}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
