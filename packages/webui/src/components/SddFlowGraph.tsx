/**
 * SddFlowGraph — the visual centerpiece of the SDD show. Renders a task graph
 * as an animated React Flow DAG: topological columns, dependency edges that
 * "flow" when their downstream task is active, and per-task nodes that glow
 * while a worker runs them, flash on completion, and shake on failure. Used by
 * both the wizard (decomposition reveal) and the live board (execution show).
 */
import { useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, Loader2, X, GitBranch, RotateCcw, CircleDot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusStyle, priorityStyle, agentInitials } from '@/lib/sdd-theme';

export type FlowStatus =
  | 'pending'
  | 'queued'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'failed'
  | 'completed'
  | 'cancelled';

export interface FlowTask {
  id: string;
  shortId: string;
  title: string;
  displayStatus: FlowStatus;
  priority: 'critical' | 'high' | 'medium' | 'low';
  deps: string[];
  agentName?: string | undefined;
  worktreeBranch?: string | undefined;
  retries?: number | undefined;
}

export interface FlowColumn {
  label: string;
  taskIds: string[];
}

const COL_W = 300;
const ROW_H = 128;
const NODE_W = 240;

const STATUS: Record<
  FlowStatus,
  { ring: string; chip: string; dot: string; label: string }
> = {
  pending: { ring: 'border-slate-600/50', chip: 'bg-slate-700/40 text-slate-400', dot: 'bg-slate-500', label: 'pending' },
  queued: { ring: 'border-cyan-500/50', chip: 'bg-cyan-500/15 text-cyan-300', dot: 'bg-cyan-400', label: 'queued' },
  in_progress: { ring: 'border-amber-400/70', chip: 'bg-amber-500/20 text-amber-300', dot: 'bg-amber-400', label: 'running' },
  blocked: { ring: 'border-fuchsia-500/50', chip: 'bg-fuchsia-500/15 text-fuchsia-300', dot: 'bg-fuchsia-400', label: 'blocked' },
  review: { ring: 'border-sky-500/50', chip: 'bg-sky-500/15 text-sky-300', dot: 'bg-sky-400', label: 'review' },
  failed: { ring: 'border-red-500/60', chip: 'bg-red-500/15 text-red-300', dot: 'bg-red-400', label: 'failed' },
  completed: { ring: 'border-emerald-500/55', chip: 'bg-emerald-500/15 text-emerald-300', dot: 'bg-emerald-400', label: 'done' },
  cancelled: { ring: 'border-slate-500/50', chip: 'bg-slate-600/25 text-slate-400', dot: 'bg-slate-500', label: 'cancelled' },
};

interface TaskNodeData extends Record<string, unknown> {
  task: FlowTask;
  index: number;
  onTaskClick?: ((id: string) => void) | undefined;
}

function TaskNode({ data }: { data: TaskNodeData }) {
  const t = data.task;
  const s = STATUS[t.displayStatus];
  const running = t.displayStatus === 'in_progress';
  const StatusIcon =
    t.displayStatus === 'completed'
      ? Check
      : t.displayStatus === 'failed'
        ? X
        : running
          ? Loader2
          : CircleDot;

  return (
    <div
      className={cn(
        'sdd-node-enter group relative rounded-lg border bg-[#0e1117]/95 px-2.5 py-2 text-left shadow-lg backdrop-blur',
        s.ring,
        running && 'sdd-node-running',
        t.displayStatus === 'completed' && 'sdd-node-complete',
        t.displayStatus === 'failed' && 'sdd-node-failed',
        data.onTaskClick && 'cursor-pointer hover:brightness-125',
      )}
      style={{ width: NODE_W, animationDelay: `${Math.min(data.index * 45, 600)}ms` }}
      onClick={() => data.onTaskClick?.(t.id)}
    >
      {/* Columns flow left→right (a task's deps sit in earlier/left columns),
          so edges enter on the Left and leave on the Right. */}
      <Handle type="target" position={Position.Left} isConnectable={false} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />

      {/* header row: status + short id + priority */}
      <div className="flex items-center gap-1.5">
        <StatusIcon
          className={cn('h-3.5 w-3.5', running && 'animate-spin', s.chip.split(' ').find((c) => c.startsWith('text')))}
        />
        <span className="font-mono text-[10px] text-slate-500">{t.shortId}</span>
        <span className={cn('font-mono text-[10px] font-bold uppercase', priorityStyle(t.priority).text)}>
          {t.priority[0]}
        </span>
        <span className={cn('ml-auto rounded px-1.5 py-px text-[9px] font-medium', s.chip)}>{s.label}</span>
      </div>

      {/* title */}
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-200">{t.title}</p>

      {/* live worker + worktree */}
      {(t.agentName || t.worktreeBranch) && (
        <div className="mt-1.5 flex items-center gap-1.5">
          {t.agentName && (
            <span className="flex items-center gap-1">
              <span
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white',
                  running ? 'bg-amber-500 sdd-agent-live' : 'bg-slate-600',
                )}
              >
                {agentInitials(t.agentName)}
              </span>
              <span className="max-w-[88px] truncate text-[10px] text-slate-300">{t.agentName}</span>
            </span>
          )}
          {t.retries ? (
            <span className="flex items-center gap-0.5 text-[9px] text-red-400">
              <RotateCcw className="h-2.5 w-2.5" />
              {t.retries}
            </span>
          ) : null}
          {t.worktreeBranch && (
            <span className="ml-auto flex items-center gap-0.5 text-[9px] text-slate-500" title={t.worktreeBranch}>
              <GitBranch className="h-2.5 w-2.5" />
              <span className="max-w-[70px] truncate">{t.worktreeBranch.replace(/^.*\//, '')}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Column header label (React Flow's built-in 'group' node does not render text). */
function ColLabelNode({ data }: { data: { label: string } }) {
  return (
    <div className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wider text-slate-500">
      {data.label}
    </div>
  );
}

const nodeTypes: NodeTypes = { task: TaskNode, colLabel: ColLabelNode };

function buildGraph(
  tasks: FlowTask[],
  columns: FlowColumn[],
  onTaskClick?: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const byShort = new Map(tasks.map((t) => [t.shortId, t]));

  const nodes: Node[] = [];
  let idx = 0;
  columns.forEach((col, ci) => {
    // column header label
    nodes.push({
      id: `__col_${ci}`,
      position: { x: ci * COL_W, y: -52 },
      data: { label: col.label },
      draggable: false,
      selectable: false,
      type: 'colLabel',
      style: { pointerEvents: 'none' },
    });
    col.taskIds.forEach((sid, ri) => {
      const t = byShort.get(sid);
      if (!t) return;
      nodes.push({
        id: t.id,
        position: { x: ci * COL_W, y: ri * ROW_H },
        data: { task: t, index: idx++, onTaskClick } satisfies TaskNodeData,
        type: 'task',
        draggable: true,
      });
    });
  });

  const edges: Edge[] = [];
  for (const t of tasks) {
    for (const depShort of t.deps) {
      const dep = byShort.get(depShort);
      if (!dep) continue;
      const flowing =
        dep.displayStatus === 'completed' &&
        (t.displayStatus === 'in_progress' || t.displayStatus === 'queued');
      edges.push({
        id: `${dep.id}->${t.id}`,
        source: dep.id,
        target: t.id,
        animated: flowing,
        className: flowing ? 'sdd-edge-flow' : undefined,
        style: {
          stroke: statusStyle(t.displayStatus).hex,
          strokeWidth: flowing ? 2.2 : 1.4,
          opacity: t.displayStatus === 'pending' ? 0.4 : 0.85,
        },
      });
    }
  }
  return { nodes, edges };
}

function FlowInner({
  tasks,
  columns,
  onTaskClick,
}: {
  tasks: FlowTask[];
  columns: FlowColumn[];
  onTaskClick?: ((id: string) => void) | undefined;
}) {
  const { fitView } = useReactFlow();
  const { nodes, edges } = useMemo(
    () => buildGraph(tasks, columns, onTaskClick),
    [tasks, columns, onTaskClick],
  );

  // Re-fit when the task count changes (graph materialized / new wave).
  const taskCount = tasks.length;
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.18, duration: 400 }), 60);
    return () => clearTimeout(t);
  }, [taskCount, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable={!!onTaskClick}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
      <Controls showInteractive={false} className="!bottom-2 !left-2" />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={2}
        maskColor="rgba(2,6,23,0.65)"
        nodeColor={(n) => {
          const d = n.data as TaskNodeData;
          const st = d?.task?.displayStatus;
          return st ? statusStyle(st).hex : '#334155';
        }}
        className="!bottom-2 !right-2 !h-24 !w-40 overflow-hidden rounded-md border border-white/10"
      />
    </ReactFlow>
  );
}

export function SddFlowGraph({
  tasks,
  columns,
  onTaskClick,
}: {
  tasks: FlowTask[];
  columns: FlowColumn[];
  onTaskClick?: ((id: string) => void) | undefined;
}): React.ReactElement {
  return (
    <ReactFlowProvider>
      <FlowInner tasks={tasks} columns={columns} onTaskClick={onTaskClick} />
    </ReactFlowProvider>
  );
}
