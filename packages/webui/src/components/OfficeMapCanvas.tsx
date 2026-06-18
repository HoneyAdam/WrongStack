/**
 * OfficeMapCanvas — React Flow canvas with real-time office environment visualization.
 *
 * Displays all connected clients (WebUI, TUI, REPL, etc.) as nodes in an office floor plan.
 * Shows live status (mail read, mail sent, idle, active, error) with animated wire connections.
 * Uses viz store for real-time events and fleet store for agent status.
 */

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  BackgroundVariant,
  useReactFlow,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Monitor,
  Terminal,
  Mail,
  Wifi,
  WifiOff,
  Cpu,
  Send,
  Inbox,
  Building2,
  Users,
  Armchair,
  AppWindow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useFleetStore,
  useSessionStore,
  useVizStore,
  useMailboxStore,
} from '@/stores';

// ── Client Types ─────────────────────────────────────────────────────────────

type ClientKind = 'webui' | 'tui' | 'repl' | 'coordinator' | 'agent' | 'mailbox';
type ClientStatus = 'idle' | 'active' | 'streaming' | 'completed' | 'error' | 'offline';

interface OfficeNodeData extends Record<string, unknown> {
  label: string;
  sublabel?: string;
  kind: ClientKind;
  status: ClientStatus;
  unreadCount?: number;
  messageCount?: number;
  currentTask?: string;
  iteration?: number;
  toolCalls?: number;
  lastSeenAt?: number;
  connections?: number;
  color?: string;
}

// ── Status LED ─────────────────────────────────────────────────────────────

function StatusLED({ status, small }: { status: ClientStatus; small?: boolean }) {
  const size = small ? 'w-2 h-2' : 'w-3 h-3';

  const styles: Record<ClientStatus, string> = {
    idle: 'bg-gray-500',
    active: 'bg-emerald-500 animate-pulse',
    streaming: 'bg-blue-500 animate-pulse',
    completed: 'bg-blue-500',
    error: 'bg-red-500 animate-pulse',
    offline: 'bg-gray-600',
  };

  return (
    <span
      className={cn('rounded-full', size, styles[status])}
      style={status === 'active' ? { boxShadow: '0 0 8px hsl(140,70%,50%)' } : undefined}
    />
  );
}

// ── Node Components ─────────────────────────────────────────────────────────

function WebUINode({ data }: { data: OfficeNodeData }) {
  const isActive = data.status === 'active' || data.status === 'streaming';
  const isError = data.status === 'error';
  const isOffline = data.status === 'offline';
  const color = data.color || '#3b82f6';

  return (
    <div className={cn(
      'rounded-xl border-2 p-4 min-w-[180px] transition-all backdrop-blur-sm',
      isActive && 'shadow-lg shadow-blue-500/20',
      isError && 'border-red-500/50 bg-red-500/10',
      isOffline && 'border-gray-500/30 bg-gray-500/5 opacity-60',
      !isActive && !isError && !isOffline && 'border-blue-500/30 bg-blue-500/10',
    )}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          'flex items-center justify-center w-10 h-10 rounded-lg',
          isActive ? 'bg-blue-500/20' : 'bg-blue-500/10',
        )}>
          <Monitor className="h-5 w-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold truncate" style={{ color }}>{data.label}</div>
          <div className="text-[10px] text-gray-500">WebUI Client</div>
        </div>
        <StatusLED status={data.status} />
      </div>

      {data.sublabel && (
        <div className="text-[10px] text-gray-400 mb-2 truncate">
          {data.sublabel}
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-gray-500">
        {isOffline ? (
          <>
            <WifiOff className="h-3 w-3 text-gray-500" />
            <span>Disconnected</span>
          </>
        ) : (
          <>
            <Wifi className="h-3 w-3 text-emerald-500" />
            <span>Connected</span>
          </>
        )}
      </div>

      {isActive && (
        <div className="mt-2 h-1 rounded-full bg-blue-500/30 overflow-hidden">
          <div className="h-full bg-blue-500 animate-pulse" style={{ width: '60%' }} />
        </div>
      )}
    </div>
  );
}

function TUINode({ data }: { data: OfficeNodeData }) {
  const isActive = data.status === 'active' || data.status === 'streaming';
  const isError = data.status === 'error';
  const color = data.color || '#22c55e';

  return (
    <div className={cn(
      'rounded-xl border-2 p-4 min-w-[180px] transition-all backdrop-blur-sm',
      isActive && 'shadow-lg shadow-emerald-500/20',
      isError && 'border-red-500/50 bg-red-500/10',
      !isActive && !isError && 'border-emerald-500/30 bg-emerald-500/10',
    )}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          'flex items-center justify-center w-10 h-10 rounded-lg',
          isActive ? 'bg-emerald-500/20' : 'bg-emerald-500/10',
        )}>
          <Terminal className="h-5 w-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold truncate" style={{ color }}>{data.label}</div>
          <div className="text-[10px] text-gray-500">TUI Client</div>
        </div>
        <StatusLED status={data.status} />
      </div>

      {data.sublabel && (
        <div className="text-[10px] text-gray-400 mb-2 truncate">
          {data.sublabel}
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-gray-500">
        <Terminal className="h-3 w-3 text-emerald-500" />
        <span>Terminal</span>
      </div>
    </div>
  );
}

function REPLNode({ data }: { data: OfficeNodeData }) {
  const isActive = data.status === 'active' || data.status === 'streaming';
  const color = data.color || '#f59e0b';

  return (
    <div className={cn(
      'rounded-xl border-2 p-4 min-w-[160px] transition-all backdrop-blur-sm',
      isActive && 'shadow-lg shadow-amber-500/20',
      !isActive && 'border-amber-500/30 bg-amber-500/10',
    )}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          'flex items-center justify-center w-10 h-10 rounded-lg',
          isActive ? 'bg-amber-500/20' : 'bg-amber-500/10',
        )}>
          <Terminal className="h-5 w-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold truncate" style={{ color }}>{data.label}</div>
          <div className="text-[10px] text-gray-500">REPL</div>
        </div>
        <StatusLED status={data.status} />
      </div>
    </div>
  );
}

function CoordinatorNode({ data }: { data: OfficeNodeData }) {
  const isActive = data.status === 'active' || data.status === 'streaming';
  const isError = data.status === 'error';
  const color = data.color || '#a855f7';

  return (
    <div className="rounded-xl border-2 p-4 min-w-[200px] transition-all backdrop-blur-sm relative bg-slate-900/90">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-purple-600 text-white text-[9px] rounded-full font-bold">
        COORDINATOR
      </div>

      <div className="flex items-center gap-3 mb-3 mt-2">
        <div className={cn(
          'flex items-center justify-center w-12 h-12 rounded-xl',
          isActive ? 'bg-purple-500/20' : 'bg-purple-500/10',
        )}>
          <Cpu className="h-6 w-6" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate" style={{ color }}>{data.label}</div>
          <div className="text-[10px] text-gray-500">Fleet Coordinator</div>
        </div>
        <StatusLED status={data.status} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
        <div className="bg-black/20 rounded p-1.5 text-center">
          <div className="font-mono text-purple-400">{data.connections || 0}</div>
          <div className="text-gray-500">Connections</div>
        </div>
        <div className="bg-black/20 rounded p-1.5 text-center">
          <div className="font-mono text-purple-400">{data.iteration || 0}</div>
          <div className="text-gray-500">Iterations</div>
        </div>
      </div>

      {isActive && (
        <div className="flex items-center gap-2 text-[10px] text-purple-400">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          Coordinating fleet
        </div>
      )}
    </div>
  );
}

function AgentNode({ data }: { data: OfficeNodeData }) {
  const isActive = data.status === 'active' || data.status === 'streaming';
  const isError = data.status === 'error';
  const isCompleted = data.status === 'completed';
  const color = data.color || '#06b6d4';

  return (
    <div className={cn(
      'rounded-lg border p-3 min-w-[150px] transition-all backdrop-blur-sm',
      isActive && 'border-cyan-500/50 bg-cyan-500/10 shadow-lg shadow-cyan-500/10',
      isError && 'border-red-500/50 bg-red-500/10',
      isCompleted && 'border-gray-500/30 bg-gray-500/5',
      !isActive && !isError && !isCompleted && 'border-cyan-500/30 bg-cyan-500/10',
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Bot className="h-4 w-4" style={{ color }} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold truncate" style={{ color }}>{data.label}</div>
        </div>
        <StatusLED status={data.status} small />
      </div>

      {data.currentTask && (
        <div className="text-[9px] text-gray-400 truncate mb-1">
          {data.currentTask}
        </div>
      )}

      <div className="flex items-center gap-3 text-[9px] text-gray-500">
        <span>iter {data.iteration || 0}</span>
        <span>tools {data.toolCalls || 0}</span>
      </div>

      {isActive && (
        <div className="mt-2 h-1 rounded-full bg-cyan-500/30 overflow-hidden">
          <div className="h-full bg-cyan-500 animate-pulse" style={{ width: '40%' }} />
        </div>
      )}
    </div>
  );
}

function DeskNode({ data }: { data: OfficeNodeData }) {
  const color = data.color || '#374151';

  return (
    <div className={cn(
      'rounded-lg border border-dashed p-3 min-w-[120px] transition-all opacity-40',
      'border-gray-600 bg-gray-800/30',
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Armchair className="h-4 w-4 text-gray-600" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-gray-500 truncate">{data.label}</div>
        </div>
        <StatusLED status={data.status} small />
      </div>
      <div className="text-[9px] text-gray-600">Available desk</div>
    </div>
  );
}

function MailboxNode({ data }: { data: OfficeNodeData }) {
  const color = data.color || '#eab308';
  const hasUnread = (data.unreadCount || 0) > 0;

  return (
    <div className={cn(
      'rounded-xl border-2 p-4 min-w-[160px] transition-all backdrop-blur-sm',
      hasUnread && 'border-yellow-500/50 bg-yellow-500/10 shadow-lg shadow-yellow-500/10',
      !hasUnread && 'border-yellow-500/30 bg-yellow-500/5',
    )}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          'flex items-center justify-center w-10 h-10 rounded-lg',
          hasUnread ? 'bg-yellow-500/20' : 'bg-yellow-500/10',
        )}>
          <Mail className="h-5 w-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold" style={{ color }}>Mailbox Hub</div>
          <div className="text-[10px] text-gray-500">
            {hasUnread ? `${data.unreadCount} unread` : 'All clear'}
          </div>
        </div>
        {hasUnread && (
          <div className="w-5 h-5 rounded-full bg-yellow-500 text-black text-[10px] font-bold flex items-center justify-center">
            {data.unreadCount}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="bg-black/20 rounded p-1.5 text-center">
          <div className="flex items-center justify-center gap-1 text-yellow-400">
            <Send className="h-3 w-3" />
            <span>{data.messageCount || 0}</span>
          </div>
          <div className="text-gray-500">Total</div>
        </div>
        <div className="bg-black/20 rounded p-1.5 text-center">
          <div className="flex items-center justify-center gap-1 text-emerald-400">
            <Inbox className="h-3 w-3" />
            <span>{data.unreadCount || 0}</span>
          </div>
          <div className="text-gray-500">Unread</div>
        </div>
      </div>
    </div>
  );
}

// ── Node Type Map ────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  webui: WebUINode,
  tui: TUINode,
  repl: REPLNode,
  coordinator: CoordinatorNode,
  agent: AgentNode,
  mailbox: MailboxNode,
  desk: DeskNode,
};

const edgeTypes: EdgeTypes = {
  wire: ({ id, sourceX, sourceY, targetX, targetY, data, selected }: any) => {
    const color = data?.color || '#6366f1';
    const isAnimated = data?.animated;
    const flowType = data?.flowType || 'heartbeat';

    const meta: Record<string, { icon: string; label: string }> = {
      mail: { icon: '✉', label: 'mail' },
      status: { icon: '●', label: 'status' },
      spawn: { icon: '★', label: 'spawn' },
      task: { icon: '→', label: 'task' },
      heartbeat: { icon: '♥', label: 'hb' },
    };

    const m = meta[flowType] || meta.heartbeat;

    // Bezier path
    const dx = Math.abs(targetX - sourceX);
    const offset = Math.max(50, dx * 0.4);
    const cx = (sourceX + targetX) / 2;
    const cy = Math.min(sourceY, targetY) - offset;

    const path = `M ${sourceX} ${sourceY} C ${sourceX} ${cy}, ${targetX} ${cy}, ${targetX} ${targetY}`;
    const labelX = cx;
    const labelY = cy;

    return (
      <>
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={selected ? 3 : 2}
          strokeOpacity={selected ? 0.9 : 0.5}
          className="react-flow__edge-path"
        />
        {isAnimated && (
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeDasharray="8 4"
            opacity={0.8}
          />
        )}
        {data?.label && (
          <foreignObject
            width={80}
            height={24}
            x={labelX - 40}
            y={labelY - 12}
            className="overflow-visible"
          >
            <div className="flex items-center justify-center gap-1">
              <span className="text-[10px]">{m.icon}</span>
              <div className={cn(
                'px-2 py-0.5 rounded-full border text-[9px] font-medium',
                'bg-slate-800/80 border-white/20 text-white/90'
              )}>
                {data.label}
              </div>
            </div>
          </foreignObject>
        )}
        <defs>
          <marker
            id={`arrow-${color.replace('#', '')}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity={0.7} />
          </marker>
        </defs>
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          markerEnd={`url(#arrow-${color.replace('#', '')})`}
        />
      </>
    );
  },
};

// ── Office Layout ────────────────────────────────────────────────────────────

interface LayoutPosition {
  x: number;
  y: number;
}

/**
 * Office floor plan layout:
 *
 *  ┌─────────────────────────────────────────────────────┐
 *  │  LOBBY (Mailbox Hub)                                │
 *  │  [Mailbox]                                         │
 *  └─────────────────────────────────────────────────────┘
 *  ┌─────────────────────────────────────────────────────┐
 *  │  EXECUTIVE FLOOR                                   │
 *  │  [Coordinator]                                      │
 *  └─────────────────────────────────────────────────────┘
 *  ┌─────────────────────────────────────────────────────┐
 *  │  ENGINEERING FLOOR                                 │
 *  │  [TUI]  [WebUI]  [REPL]                            │
 *  └─────────────────────────────────────────────────────┘
 *  ┌─────────────────────────────────────────────────────┐
 *  │  WORKER FLOOR                                      │
 *  │  [Agent 1] [Agent 2] [Agent 3] [Agent 4] ...       │
 *  └─────────────────────────────────────────────────────┘
 */

function getOfficeLayout(maxAgents: number): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();

  // Lobby - top center
  positions.set('mailbox', { x: 400, y: 60 });

  // Executive floor - coordinator
  positions.set('coordinator', { x: 400, y: 180 });

  // Engineering floor - client nodes
  positions.set('client-tui', { x: 200, y: 300 });
  positions.set('client-webui', { x: 400, y: 300 });
  positions.set('client-repl', { x: 600, y: 300 });

  // Worker floor - agent nodes in a row
  const agentSpacing = 140;
  const agentStartX = 80;
  for (let i = 0; i < maxAgents; i++) {
    positions.set(`agent-${i}`, { x: agentStartX + i * agentSpacing, y: 450 });
    positions.set(`desk-${i}`, { x: agentStartX + i * agentSpacing, y: 450 });
  }

  return positions;
}

// ── Main Canvas Component ────────────────────────────────────────────────────

export function OfficeMapCanvas() {
  const { fitView } = useReactFlow();

  // Store subscriptions
  const vizEvents = useVizStore((s) => s.events);
  const fleetAgents = useFleetStore((s) => s.agents);
  const leaderId = useFleetStore((s) => s.leaderId);

  const mailboxMessages = useMailboxStore((s) => s.messages);
  const session = useSessionStore((s) => s.session);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<OfficeNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node<OfficeNodeData> | null>(null);

  const maxAgents = 8;

  // Build nodes from store data
  useEffect(() => {
    const rfNodes: Node<OfficeNodeData>[] = [];
    const rfEdges: Edge[] = [];
    const layout = getOfficeLayout(maxAgents);

    // ── Mailbox Node ──────────────────────────────────────────────
    const unreadCount = mailboxMessages.filter(
      (m) => !m.completed && (m.readByCount ?? 0) === 0,
    ).length;
    const mailboxPos = layout.get('mailbox')!;

    rfNodes.push({
      id: 'mailbox',
      type: 'mailbox',
      position: mailboxPos,
      data: {
        label: 'Mailbox Hub',
        kind: 'mailbox',
        status: unreadCount > 0 ? 'active' : 'idle',
        unreadCount,
        messageCount: mailboxMessages.length,
        color: '#eab308',
      },
    });

    // ── Coordinator Node ─────────────────────────────────────────
    const coordPos = layout.get('coordinator')!;
    const leaderAgent = leaderId ? fleetAgents.get(leaderId) : null;

    rfNodes.push({
      id: 'coordinator',
      type: 'coordinator',
      position: coordPos,
      data: {
        label: leaderAgent?.name || 'Fleet Coordinator',
        sublabel: session?.model || 'claude-3-5-sonnet',
        kind: 'coordinator',
        status:
          leaderAgent?.status === 'running'
            ? 'active'
            : leaderAgent?.status === 'failed'
              ? 'error'
              : 'idle',
        iteration: leaderAgent?.iteration || 0,
        connections: fleetAgents.size,
        color: '#a855f7',
      },
    });

    // ── Client Nodes ──────────────────────────────────────────────
    const clientTypes: Array<{
      id: string;
      type: ClientKind;
      label: string;
      color: string;
    }> = [
      { id: 'client-tui', type: 'tui', label: 'Terminal UI', color: '#22c55e' },
      { id: 'client-webui', type: 'webui', label: 'Web UI', color: '#3b82f6' },
      { id: 'client-repl', type: 'repl', label: 'REPL', color: '#f59e0b' },
    ];

    clientTypes.forEach((client) => {
      const pos = layout.get(client.id)!;
      const isConnected = client.id !== 'client-repl'; // REPL assumed offline for demo

      rfNodes.push({
        id: client.id,
        type: client.type,
        position: pos,
        data: {
          label: client.label,
          sublabel: isConnected ? 'Connected' : 'Offline',
          kind: client.type,
          status: isConnected ? 'active' : 'offline',
          color: client.color,
        },
      });

      // Wire: Client → Coordinator
      rfEdges.push({
        id: `${client.id}->coordinator`,
        source: client.id,
        target: 'coordinator',
        type: 'wire',
        animated: isConnected,
        data: {
          color: client.color,
          animated: isConnected,
          label: 'control',
          flowType: 'task',
        },
      });

      // Wire: Mailbox → Client
      rfEdges.push({
        id: `mailbox->${client.id}`,
        source: 'mailbox',
        target: client.id,
        type: 'wire',
        animated: unreadCount > 0,
        data: {
          color: '#eab308',
          animated: unreadCount > 0,
          label: unreadCount > 0 ? `${unreadCount}` : undefined,
          flowType: 'mail',
        },
      });
    });

    // ── Agent Nodes ──────────────────────────────────────────────
    const fleetArray = Array.from(fleetAgents.values());

    if (fleetArray.length > 0) {
      fleetArray.slice(0, maxAgents).forEach((agent, i) => {
        const pos = layout.get(`agent-${i}`)!;
        const isActive = agent.status === 'running';

        rfNodes.push({
          id: `agent-${agent.id}`,
          type: 'agent',
          position: pos,
          data: {
            label: agent.name,
            kind: 'agent',
            status: isActive
              ? 'active'
              : agent.status === 'completed'
                ? 'completed'
                : agent.status === 'failed'
                  ? 'error'
                  : 'idle',
            currentTask: agent.currentTool || agent.lastTool,
            iteration: agent.iteration,
            toolCalls: agent.toolCalls,
            lastSeenAt: agent.startedAt,
            color: '#06b6d4',
          },
        });

        // Wire: Coordinator → Agent
        rfEdges.push({
          id: `coordinator->agent-${agent.id}`,
          source: 'coordinator',
          target: `agent-${agent.id}`,
          type: 'wire',
          animated: isActive,
          data: {
            color: '#a855f7',
            animated: isActive,
            label: isActive ? 'task' : undefined,
            flowType: 'task',
          },
        });

        // Wire: Agent → Mailbox
        rfEdges.push({
          id: `agent-${agent.id}->mailbox`,
          source: `agent-${agent.id}`,
          target: 'mailbox',
          type: 'wire',
          animated: false,
          data: {
            color: '#06b6d4',
            animated: false,
            label: 'mail',
            flowType: 'mail',
          },
        });
      });
    } else {
      // Empty desks when no agents
      for (let i = 0; i < maxAgents; i++) {
        const pos = layout.get(`desk-${i}`)!;
        rfNodes.push({
          id: `desk-${i}`,
          type: 'desk',
          position: pos,
          data: {
            label: `Desk ${i + 1}`,
            kind: 'agent',
            status: 'idle',
            color: '#374151',
          },
        });
      }
    }

    setNodes(rfNodes);
    setEdges(rfEdges);

    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
  }, [fleetAgents, leaderId, mailboxMessages, session, maxAgents, setNodes, setEdges, fitView]);

  // Handle viz events for live updates
  useEffect(() => {
    if (vizEvents.length === 0) return;

    const latestEvent = vizEvents[0];
    if (!latestEvent) return;

    if (latestEvent.kind === 'mailbox:send' || latestEvent.kind === 'mailbox:deliver') {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === 'mailbox' ? { ...n, data: { ...n.data, status: 'active' as const } } : n,
        ),
      );
    }

    if (latestEvent.kind === 'agent:spawned') {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === latestEvent.source
            ? { ...n, data: { ...n.data, status: 'active' as const } }
            : n,
        ),
      );
    }
  }, [vizEvents, setNodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, type: 'wire' }, eds)),
    [setEdges],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node as Node<OfficeNodeData>);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Live indicator pulse
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Room labels */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <div className="bg-slate-800/90 backdrop-blur px-4 py-2 rounded-lg border border-slate-700 shadow-xl">
          <div className="text-xs font-bold text-slate-300 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-purple-400" />
            WrongStack Fleet HQ
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-2" />
            <span className="text-[10px] text-gray-400 font-normal">LIVE</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 bg-slate-800/90 backdrop-blur rounded-lg border border-slate-700 p-3 text-[10px]">
        <div className="font-bold text-gray-300 mb-2">Status</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-gray-400">Active</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            <span className="text-gray-400">Idle</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-gray-400">Error</span>
          </div>
        </div>
      </div>

      {/* Connection type legend */}
      <div className="absolute bottom-4 right-4 z-10 bg-slate-800/90 backdrop-blur rounded-lg border border-slate-700 p-3 text-[10px]">
        <div className="font-bold text-gray-300 mb-2">Connections</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-yellow-400">✉</span>
            <span className="text-gray-400">Mail</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-purple-400">→</span>
            <span className="text-gray-400">Task</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">●</span>
            <span className="text-gray-400">Status</span>
          </div>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.5}
        defaultEdgeOptions={{
          type: 'wire',
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(255,255,255,0.05)"
        />
        <Controls
          className="bg-slate-800 border border-slate-700 rounded-lg [&>button]:bg-slate-700 [&>button]:text-slate-200"
        />
        <MiniMap
          className="bg-slate-800/90 border border-slate-700 rounded-lg"
          nodeColor={(n) => {
            const data = n.data as OfficeNodeData;
            switch (data.kind) {
              case 'coordinator':
                return '#a855f7';
              case 'webui':
                return '#3b82f6';
              case 'tui':
                return '#22c55e';
              case 'repl':
                return '#f59e0b';
              case 'mailbox':
                return '#eab308';
              case 'agent':
                return '#06b6d4';
              default:
                return '#6366f1';
            }
          }}
          maskColor="rgba(0,0,0,0.8)"
        />
      </ReactFlow>

      {/* Selected node detail panel */}
      {selectedNode && (
        <div className="absolute top-20 right-4 w-64 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-lg p-4 shadow-xl z-20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {selectedNode.data.kind === 'webui' && <Monitor className="h-4 w-4 text-blue-500" />}
              {selectedNode.data.kind === 'tui' && <Terminal className="h-4 w-4 text-emerald-500" />}
              {selectedNode.data.kind === 'coordinator' && <Cpu className="h-4 w-4 text-purple-500" />}
              {selectedNode.data.kind === 'agent' && <Bot className="h-4 w-4 text-cyan-500" />}
              {selectedNode.data.kind === 'mailbox' && <Mail className="h-4 w-4 text-yellow-500" />}
              <span className="text-sm font-bold text-white">{selectedNode.data.label}</span>
            </div>
            <button
              onClick={onPaneClick}
              className="text-gray-400 hover:text-white text-lg"
            >
              ×
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">Status</span>
              <span className={cn(
                selectedNode.data.status === 'active' && 'text-emerald-400',
                selectedNode.data.status === 'error' && 'text-red-400',
                selectedNode.data.status === 'idle' && 'text-gray-400',
                selectedNode.data.status === 'offline' && 'text-gray-500',
              )}>
                {String(selectedNode.data.status).toUpperCase()}
              </span>
            </div>

            {selectedNode.data.kind === 'agent' && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-400">Iterations</span>
                  <span className="text-cyan-400 font-mono">{selectedNode.data.iteration || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Tool Calls</span>
                  <span className="text-cyan-400 font-mono">{selectedNode.data.toolCalls || 0}</span>
                </div>
              </>
            )}

            {selectedNode.data.kind === 'mailbox' && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Messages</span>
                  <span className="text-yellow-400 font-mono">{selectedNode.data.messageCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Unread</span>
                  <span className="text-yellow-400 font-mono">{selectedNode.data.unreadCount || 0}</span>
                </div>
              </>
            )}

            {selectedNode.data.kind === 'coordinator' && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-400">Connections</span>
                  <span className="text-purple-400 font-mono">{selectedNode.data.connections || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Iterations</span>
                  <span className="text-purple-400 font-mono">{selectedNode.data.iteration || 0}</span>
                </div>
              </>
            )}

            {selectedNode.data.sublabel && (
              <div className="pt-2 border-t border-slate-700">
                <span className="text-gray-400">{selectedNode.data.sublabel}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}