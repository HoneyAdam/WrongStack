import type { NodeProps } from '@xyflow/react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import { Bot, FolderGit2, GitBranch, MonitorSmartphone, SquareTerminal } from 'lucide-react';
import type React from 'react';
import { useMemo } from 'react';
import { selectAgent, selectSession, setActiveView, useHqStore } from '../store.js';
import { buildFleetTopology, type FleetTopologyNode } from './fleet-topology.js';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 104;
const COLUMN_GAP = 300;
const ROW_GAP = 146;
const AGENT_ROW_GAP = 118;

function kindIcon(kind: FleetTopologyNode['kind'], clientKind?: string): React.ReactNode {
  if (kind === 'machine') return <MonitorSmartphone size={14} className="hq-fleet-node-icon" />;
  if (kind === 'project') return <FolderGit2 size={14} className="hq-fleet-node-icon" />;
  if (kind === 'terminal') return <SquareTerminal size={14} className="hq-fleet-node-icon" />;
  return <Bot size={14} className={`hq-fleet-agent-dot ${clientKind ?? 'idle'}`} />;
}

function statusClass(status: string | undefined): string {
  if (status === undefined) return 'idle';
  if (status === 'active' || status === 'running' || status === 'streaming') return 'active';
  if (status === 'waiting_user') return 'warn';
  if (status === 'error' || status === 'stale' || status === 'closing') return 'error';
  return status;
}

function FleetFlowNode({ data, selected }: NodeProps<Node<FleetTopologyNode, 'fleet'>>): React.ReactElement {
  const clickable = data.kind === 'terminal' || data.kind === 'agent';
  return (
    <div className={`hq-flow-node ${data.kind}${selected ? ' selected' : ''}${clickable ? ' clickable' : ''}`}>
      <Handle type="target" position={Position.Left} className="hq-flow-handle" />
      <div className="hq-flow-title">
        {data.kind === 'agent' ? (
          <span className={`hq-flow-dot ${statusClass(data.status)}`} />
        ) : (
          kindIcon(data.kind, data.clientKind)
        )}
        <span className="hq-flow-label">{data.label}</span>
      </div>
      {data.sub !== undefined && <div className="hq-flow-sub">{data.sub}</div>}
      <div className="hq-flow-chips">
        {data.chips.slice(0, 4).map((chip) => (
          <span key={chip} className={`hq-pill ${statusClass(chip)}`}>
            {chip}
          </span>
        ))}
      </div>
      <Handle type="source" position={Position.Right} className="hq-flow-handle" />
    </div>
  );
}

const nodeTypes = { fleet: FleetFlowNode };

function columnFor(kind: FleetTopologyNode['kind']): number {
  if (kind === 'machine') return 0;
  if (kind === 'project') return 1;
  if (kind === 'terminal') return 2;
  return 3;
}

function layoutNodes(nodes: FleetTopologyNode[]): Node<FleetTopologyNode, 'fleet'>[] {
  const machineOrder = new Map<string, number>();
  const projectOrder = new Map<string, number>();
  const terminalOrder = new Map<string, number>();
  let nextMachine = 0;
  let nextProject = 0;
  let nextTerminal = 0;

  for (const node of nodes) {
    if (node.kind === 'machine' && !machineOrder.has(node.id)) machineOrder.set(node.id, nextMachine++);
    if (node.kind === 'project' && !projectOrder.has(node.id)) projectOrder.set(node.id, nextProject++);
    if (node.kind === 'terminal' && !terminalOrder.has(node.id)) terminalOrder.set(node.id, nextTerminal++);
  }

  const agentIndexByTerminal = new Map<string, number>();
  const agentCountByTerminal = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind === 'agent' && node.sessionId !== undefined) {
      agentCountByTerminal.set(node.sessionId, (agentCountByTerminal.get(node.sessionId) ?? 0) + 1);
    }
  }

  return nodes.map((node) => {
    const col = columnFor(node.kind);
    let row = 0;
    if (node.kind === 'machine') row = machineOrder.get(node.id) ?? 0;
    else if (node.kind === 'project') row = projectOrder.get(node.id) ?? 0;
    else if (node.kind === 'terminal') row = terminalOrder.get(node.id) ?? 0;
    else {
      const terminalSessionId = node.sessionId ?? '';
      const terminalRow = terminalOrder.get(`terminal:${terminalSessionId}`) ?? 0;
      const index = agentIndexByTerminal.get(terminalSessionId) ?? 0;
      agentIndexByTerminal.set(terminalSessionId, index + 1);
      const total = agentCountByTerminal.get(terminalSessionId) ?? 1;
      row = terminalRow + (index - (total - 1) / 2) * (AGENT_ROW_GAP / ROW_GAP);
    }

    return {
      id: node.id,
      type: 'fleet',
      data: node,
      position: { x: col * COLUMN_GAP, y: row * ROW_GAP },
      style: { width: NODE_WIDTH, minHeight: NODE_HEIGHT },
    };
  });
}

export function FleetMapView(): React.ReactElement {
  const state = useHqStore(['snapshot', 'selectedSessionId']);
  const snap = state.snapshot;
  const topology = useMemo(() => buildFleetTopology(snap), [snap]);

  const nodes = useMemo(() => layoutNodes(topology.nodes), [topology.nodes]);
  const edges = useMemo<Edge[]>(
    () =>
      topology.edges.map((edge) => ({
        ...edge,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        className: 'hq-flow-edge',
      })),
    [topology.edges],
  );

  if (snap === null) {
    return <div className="hq-empty">Waiting for fleet data…</div>;
  }

  if (nodes.length === 0) {
    return (
      <div className="hq-empty">
        No machines or connected clients yet. Open a WrongStack CLI/TUI/WebUI with HQ running and
        they appear here automatically.
      </div>
    );
  }

  const machines = snap.machines?.length ?? new Set(topology.nodes.map((n) => n.machineId).filter(Boolean)).size;
  const terminals = topology.nodes.filter((n) => n.kind === 'terminal').length;
  const agents = topology.nodes.filter((n) => n.kind === 'agent').length;

  return (
    <div className="hq-flow-shell">
      <div className="hq-flow-toolbar">
        <div>
          <div className="hq-card-title" style={{ margin: 0 }}>
            Fleet Topology
          </div>
          <div className="hq-row-subtle">
            machine → project → terminal/TUI/CLI/WebUI → agent; click a terminal or agent for chat
            history
          </div>
        </div>
        <div className="hq-flow-stats">
          <span className="hq-pill info">{machines} machines</span>
          <span className="hq-pill info">{terminals} terminals</span>
          <span className="hq-pill active">{agents} agents</span>
        </div>
      </div>
      <ReactFlowProvider>
        <div className="hq-flow-canvas" data-testid="hq-react-flow-fleet">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.25}
            maxZoom={1.4}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_, node) => {
              if (node.data.sessionId !== undefined && node.data.agentId !== undefined) {
                selectAgent(node.data.sessionId, node.data.agentId);
                setActiveView('console');
              } else if (node.data.sessionId !== undefined) {
                selectSession(node.data.sessionId);
                setActiveView('console');
              }
            }}
          >
            <Background color="rgba(148, 163, 184, 0.16)" gap={22} />
            <MiniMap
              pannable
              zoomable
              className="hq-flow-minimap"
              nodeColor={(node) => {
                const kind = (node.data as FleetTopologyNode | undefined)?.kind;
                if (kind === 'machine') return 'hsl(190 86% 54%)';
                if (kind === 'project') return 'hsl(258 84% 74%)';
                if (kind === 'terminal') return 'hsl(38 94% 58%)';
                return 'hsl(150 64% 46%)';
              }}
            />
            <Controls className="hq-flow-controls" />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
      <div className="hq-flow-legend">
        <span><MonitorSmartphone size={12} /> machine</span>
        <span><FolderGit2 size={12} /> project</span>
        <span><SquareTerminal size={12} /> terminal / TUI / CLI / WebUI</span>
        <span><GitBranch size={12} /> branch shown as chip when known</span>
        <span><Bot size={12} /> AMK agent</span>
      </div>
    </div>
  );
}
