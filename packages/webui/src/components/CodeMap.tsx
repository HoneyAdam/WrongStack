/**
 * CodeMap — interactive dependency-graph view for the codebase index.
 *
 * Three drill-down levels rendered with React Flow:
 *   1. Package-level: workspace packages as nodes, cross-package symbol refs as edges.
 *   2. File-level:    files within a package, cross-file refs as edges.
 *   3. Symbol-level:  symbols within a file, call/type-ref edges.
 *
 * Clicking a node drills down. A breadcrumb trail + "back" button navigate up.
 * Data is fetched from /api/codemap/* endpoints.
 *
 * Realtime activity overlay: file write/edit/read/memory events from WS
 * highlight active graph nodes with a pulse animation. Clicking a node shows
 * its activity history (chronological log of what happened to that file).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronRight, Home, Loader2, Package, FileCode, Box, ArrowLeft, Activity as ActivityIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCodemapActivityStore, type FileActivity, type ActivityType } from '@/stores/codemap-activity-store';

// ─── Types matching the backend GraphNode/GraphEdge ───────────────────────────

interface GraphNodeData {
  id: string;
  label: string;
  kind: 'package' | 'file' | 'symbol';
  package?: string;
  file?: string;
  symbolId?: number;
  symbolKind?: string;
  symbolCount?: number;
  fileCount?: number;
}

interface GraphEdgeData {
  source: string;
  target: string;
  weight: number;
  refType: string;
}

interface CodeMapGraphResponse {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

// ─── Layout: arrange nodes in a circular/grid pattern ─────────────────────────

const NODE_W = 200;
const NODE_H = 72;
const COL_GAP = 80;
const ROW_GAP = 40;

function layoutNodes(nodes: GraphNodeData[]): { id: string; position: { x: number; y: number }; data: GraphNodeData }[] {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  return nodes.map((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id: node.id,
      position: {
        x: col * (NODE_W + COL_GAP),
        y: row * (NODE_H + ROW_GAP),
      },
      data: node,
    };
  });
}

// ─── Visual styles per node kind ──────────────────────────────────────────────

const KIND_STYLE: Record<string, { bg: string; border: string; icon: typeof Package }> = {
  package: { bg: 'bg-primary/8', border: 'border-primary/30', icon: Package },
  file: { bg: 'bg-primary/8', border: 'border-primary/30', icon: FileCode },
  symbol: { bg: 'bg-success/8', border: 'border-success/30', icon: Box },
};

// ─── Custom node component ────────────────────────────────────────────────────

interface CodeMapNodeData extends Record<string, unknown> {
  graphNode: GraphNodeData;
  onDrillDown?: ((node: GraphNodeData) => void) | undefined;
  isActive?: boolean | undefined;
  activityType?: ActivityType | undefined;
  onShowHistory?: ((filePath: string) => void) | undefined;
}

const ACTIVITY_GLOW: Record<ActivityType, string> = {
  read: 'ring-2 ring-primary/50 shadow-primary/20',
  write: 'ring-2 ring-warning/60 shadow-warning/30',
  edit: 'ring-2 ring-warning/70 shadow-warning/40',
  delete: 'ring-2 ring-destructive/60 shadow-destructive/30',
  search: 'ring-2 ring-accent/50 shadow-accent/20',
  memory: 'ring-2 ring-accent/60 shadow-accent/30',
  index: 'ring-2 ring-primary/40 shadow-primary/20',
};

function CodeMapNode({ data }: { data: CodeMapNodeData }) {
  const { graphNode, onDrillDown, isActive, activityType, onShowHistory } = data;
  const style = KIND_STYLE[graphNode.kind] ?? KIND_STYLE['file']!;
  const Icon = style.icon;
  const canDrill = graphNode.kind === 'package' || graphNode.kind === 'file';
  const glow = isActive && activityType ? ACTIVITY_GLOW[activityType] : '';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border-2 px-3 py-2 transition-all cursor-pointer',
        'bg-card text-card-foreground shadow-md hover:shadow-lg hover:scale-105',
        'min-w-[160px] max-w-[220px]',
        style.border,
        style.bg,
        glow,
        isActive && 'animate-pulse',
      )}
      onClick={(e) => {
        if (e.shiftKey && graphNode.file) {
          e.preventDefault();
          onShowHistory?.(graphNode.file);
          return;
        }
        if (canDrill) onDrillDown?.(graphNode);
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && canDrill) {
          e.preventDefault();
          onDrillDown?.(graphNode);
        }
      }}
      role={canDrill ? 'button' : undefined}
      tabIndex={canDrill ? 0 : undefined}
      title={isActive ? `Active: ${activityType} — Shift+click for history` : canDrill ? 'Click to drill down · Shift+click for activity' : undefined}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-muted-foreground/40" />
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium" title={graphNode.label}>
          {graphNode.label}
        </span>
      </div>
      {(graphNode.symbolCount !== undefined || graphNode.fileCount !== undefined) && (
        <div className="mt-0.5 flex gap-2 text-[10px] text-muted-foreground">
          {graphNode.fileCount !== undefined && <span>{graphNode.fileCount} files</span>}
          {graphNode.symbolCount !== undefined && <span>{graphNode.symbolCount} sym</span>}
        </div>
      )}
      {graphNode.symbolKind && (
        <div className="mt-0.5 text-[10px] font-mono text-muted-foreground/70">{graphNode.symbolKind}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-muted-foreground/40" />
    </div>
  );
}

const nodeTypes: NodeTypes = { codemap: CodeMapNode };

// ─── Edge color by ref type ───────────────────────────────────────────────────

const EDGE_COLOR: Record<string, string> = {
  call: 'hsl(var(--primary))',
  import: 'hsl(var(--accent))',
  type_ref: 'hsl(var(--success))',
  inherit: 'hsl(var(--warning))',
  implement: 'hsl(var(--destructive))',
};

// ─── Main CodeMap component ───────────────────────────────────────────────────

interface Breadcrumb {
  level: 'packages' | 'files' | 'symbols';
  label: string;
  package?: string;
  file?: string;
}

function CodeMapInner(): React.ReactElement {
  const [breadcrumb, setBreadcrumb] = useState<Breadcrumb[]>([
    { level: 'packages', label: 'Packages' },
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [historyFile, setHistoryFile] = useState<string | null>(null);

  // Subscribe to activity store for the drawer + overlay
  const activityState = useCodemapActivityStore();
  const fileHistory: FileActivity[] = historyFile
    ? (activityState.getActivityForFile(historyFile))
    : [];
  const pulsingFiles = activityState.getPulsingFiles();

  // Periodic re-render to expire pulses
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const handleShowHistory = useCallback((filePath: string): void => {
    setHistoryFile(filePath);
  }, []);

  const handleCloseHistory = useCallback((): void => {
    setHistoryFile(null);
  }, []);

  const current = breadcrumb[breadcrumb.length - 1]!;

  // Fetch graph data when breadcrumb changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchGraph(): Promise<void> {
      try {
        let url: string;
        if (current.level === 'packages') {
          url = '/api/codemap/packages';
        } else if (current.level === 'files') {
          url = `/api/codemap/files?package=${encodeURIComponent(current.package ?? '')}`;
        } else {
          url = `/api/codemap/symbols?file=${encodeURIComponent(current.file ?? '')}`;
        }

        const resp = await fetch(url);
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ error: resp.statusText }));
          throw new Error(body.error ?? `HTTP ${resp.status}`);
        }
        const graph: CodeMapGraphResponse = await resp.json();
        if (cancelled) return;

        const handleDrillDown = (node: GraphNodeData): void => {
          if (node.kind === 'package') {
            setBreadcrumb((prev) => [
              ...prev,
              { level: 'files', label: node.label, package: node.package ?? node.label },
            ]);
          } else if (node.kind === 'file') {
            setBreadcrumb((prev) => [
              ...prev,
              { level: 'symbols', label: node.label, file: node.file ?? node.label },
            ]);
          }
        };

        const laidOut = layoutNodes(graph.nodes);
        const flowNodes: Node[] = laidOut.map((n) => ({
          id: n.id,
          type: 'codemap',
          position: n.position,
          data: {
            graphNode: n.data,
            onDrillDown: handleDrillDown,
            onShowHistory: handleShowHistory,
            isActive: pulsingFiles.has(n.data.file ?? n.data.package ?? ''),
            activityType: activityState.getPulseType(n.data.file ?? n.data.package ?? ''),
          } satisfies CodeMapNodeData,
        }));
        const flowEdges: Edge[] = graph.edges.map((e, i) => ({
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          animated: e.weight >= 5,
          style: {
            stroke: EDGE_COLOR[e.refType] ?? 'hsl(var(--muted-foreground))',
            strokeWidth: Math.min(1 + Math.log2(e.weight + 1), 6),
          },
          label: e.weight > 1 ? String(e.weight) : undefined,
          labelStyle: { fontSize: 9, fill: 'hsl(var(--muted-foreground))' },
          labelBgStyle: { fill: 'hsl(var(--card))' },
        }));

        setNodes(flowNodes);
        setEdges(flowEdges);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    void fetchGraph();
    return () => { cancelled = true; };
  }, [current.level, current.package, current.file, setNodes, setEdges]);

  const goBack = useCallback((): void => {
    setBreadcrumb((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const goHome = useCallback((): void => {
    setBreadcrumb([{ level: 'packages', label: 'Packages' }]);
  }, []);

  const goToCrumb = useCallback((idx: number): void => {
    setBreadcrumb((prev) => prev.slice(0, idx + 1));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {breadcrumb.length > 1 && (
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}
        <button
          type="button"
          onClick={goHome}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          <Home className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1 text-sm">
          {breadcrumb.map((bc, i) => (
            <span key={`${bc.level}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
              <button
                type="button"
                onClick={() => goToCrumb(i)}
                className={cn(
                  'rounded px-1.5 py-0.5 hover:bg-muted',
                  i === breadcrumb.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {bc.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Graph canvas */}
      <div className="relative flex-1">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground">
              Make sure the codebase index is built. Run <code className="rounded bg-muted px-1">codebase-index</code> in the agent.
            </p>
          </div>
        )}
        {!loading && !error && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No symbols found at this level.</p>
          </div>
        )}
        {!loading && !error && nodes.length > 0 && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!opacity-40" />
            <Controls className="!bg-card !border !border-border !shadow-md" />
            <MiniMap
              className="!bg-card !border !border-border"
              nodeColor={(n) => {
                const kind = (n.data as CodeMapNodeData)?.graphNode?.kind;
                if (kind === 'package') return 'hsl(var(--primary))';
                if (kind === 'file') return 'hsl(var(--primary))';
                return 'hsl(var(--success))';
              }}
              maskColor="rgba(0,0,0,0.6)"
            />
          </ReactFlow>
        )}
      </div>

      {/* Legend */}
      {!loading && !error && nodes.length > 0 && (
        <div className="flex items-center gap-3 border-t px-4 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" /> Package</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> File</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" /> Symbol</span>
          <span className="ml-auto">Click a package or file node to drill down · Shift+click for activity</span>
        </div>
      )}

      {/* Activity History Drawer */}
      {historyFile && (
        <div className="absolute right-0 top-0 z-10 flex h-full w-96 max-w-[90%] flex-col border-l bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <ActivityIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium" title={historyFile}>{historyFile}</span>
            </div>
            <button
              type="button"
              onClick={handleCloseHistory}
              className="flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {fileHistory.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded yet for this file.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {fileHistory.map((a, i) => (
                  <div key={`${a.timestamp}-${i}`} className="flex items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50">
                    <span
                      className={cn(
                        'mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                        a.type === 'write' && 'bg-warning/15 text-warning',
                        a.type === 'edit' && 'bg-warning/15 text-warning',
                        a.type === 'read' && 'bg-primary/15 text-primary',
                        a.type === 'delete' && 'bg-destructive/15 text-destructive',
                        a.type === 'memory' && 'bg-accent/15 text-accent',
                        a.type === 'search' && 'bg-accent/15 text-accent',
                        a.type === 'index' && 'bg-primary/15 text-primary',
                      )}
                    >
                      {a.type}
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(a.timestamp).toLocaleTimeString()}
                      </span>
                      {a.toolName && <span className="text-muted-foreground">via {a.toolName}</span>}
                      {a.agent && <span className="text-muted-foreground">{a.agent}</span>}
                      {a.summary && <span className="truncate text-foreground/80" title={a.summary}>{a.summary}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="border-t px-4 py-1.5 text-[10px] text-muted-foreground">
            {fileHistory.length} activit{fileHistory.length === 1 ? 'y' : 'ies'} · newest first
          </div>
        </div>
      )}
    </div>
  );
}

export function CodeMap(): React.ReactElement {
  return (
    <ReactFlowProvider>
      <CodeMapInner />
    </ReactFlowProvider>
  );
}
