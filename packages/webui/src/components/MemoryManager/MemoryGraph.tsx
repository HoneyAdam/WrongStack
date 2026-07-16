import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import type { SuperMemoryAnchor, SuperMemoryEntry } from '@/types';

interface MemoryGraphProps {
  centerMemory: SuperMemoryEntry;
  allMemories: SuperMemoryEntry[];
}

interface MemoryNodeData extends Record<string, unknown> {
  entry: SuperMemoryEntry;
  center: boolean;
}

interface AnchorNodeData extends Record<string, unknown> {
  anchor: SuperMemoryAnchor;
  label: string;
}

const NODE_WIDTH = 212;
const ANCHOR_WIDTH = 188;

function compactId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 11)}…` : id;
}

function preview(text: string, max = 58): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function anchorLabel(anchor: SuperMemoryAnchor): string {
  if (anchor.type === 'symbol') {
    return [anchor.path, anchor.symbol ? `#${anchor.symbol}` : ''].filter(Boolean).join('');
  }
  return anchor.path ?? anchor.command ?? anchor.symbol ?? anchor.type;
}

function statusTone(status: string): string {
  if (status === 'active') return 'border-success/45 bg-success/10 text-success';
  if (status === 'stale') return 'border-warning/45 bg-warning/10 text-warning';
  if (status === 'contradicted') return 'border-destructive/45 bg-destructive/10 text-destructive';
  if (status === 'superseded') return 'border-warning/35 bg-warning/5 text-warning';
  return 'border-border bg-muted/55 text-muted-foreground';
}

function MemoryNodeCard({ data }: NodeProps<Node<MemoryNodeData, 'memoryNode'>>) {
  const { entry, center } = data;
  return (
    <div
      className={
        center
          ? 'border border-primary/70 bg-card px-3 py-2.5 text-card-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.2),0_0_24px_hsl(var(--primary)/0.12)]'
          : 'border border-border/80 bg-card/95 px-3 py-2.5 text-card-foreground shadow-lg'
      }
      style={{ width: NODE_WIDTH }}
      title={entry.text}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!border-background !bg-muted-foreground"
      />
      <Handle type="source" position={Position.Bottom} className="!border-background !bg-primary" />
      <Handle type="source" position={Position.Right} className="!border-background !bg-primary" />
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${statusTone(entry.status)}`}
        >
          {entry.status}
        </span>
        <span className="ml-auto truncate font-mono text-[9px] text-muted-foreground">
          {compactId(entry.id)}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-foreground/90">
        {preview(entry.text)}
      </p>
      <p className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">{entry.kind}</p>
    </div>
  );
}

function AnchorNodeCard({ data }: NodeProps<Node<AnchorNodeData, 'anchorNode'>>) {
  return (
    <div
      className="border border-info/40 bg-info/8 px-2.5 py-2 text-card-foreground shadow-lg"
      style={{ width: ANCHOR_WIDTH }}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} className="!border-background !bg-info" />
      <p className="font-mono text-[9px] font-bold uppercase text-info">{data.anchor.type}</p>
      <p className="mt-1 truncate font-mono text-[10px] text-foreground/85">{data.label}</p>
    </div>
  );
}

const nodeTypes = {
  memoryNode: MemoryNodeCard,
  anchorNode: AnchorNodeCard,
};

function missingMemory(id: string): SuperMemoryEntry {
  return {
    id,
    revision: 0,
    scope: 'project',
    kind: 'fact',
    status: 'deleted',
    text: 'Memory is unavailable or has been removed.',
    importance: 0,
    confidence: 0,
    freshness: 0,
    tags: [],
    anchors: [],
    createdAt: '',
    updatedAt: '',
  };
}

export function MemoryGraph({ centerMemory, allMemories }: MemoryGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const nextNodes: Node[] = [];
    const nextEdges: Edge[] = [];
    const memoryById = new Map(allMemories.map((memory) => [memory.id, memory]));
    const centerX = 320;
    const centerY = 120;

    nextNodes.push({
      id: centerMemory.id,
      type: 'memoryNode',
      position: { x: centerX - NODE_WIDTH / 2, y: centerY },
      data: { entry: centerMemory, center: true },
    });

    const related: Array<{ id: string; relation: 'supersedes' | 'contradicts' | 'superseded by' }> =
      [
        ...(centerMemory.supersededBy
          ? [{ id: centerMemory.supersededBy, relation: 'superseded by' as const }]
          : []),
        ...(centerMemory.supersedes ?? []).map((id) => ({ id, relation: 'supersedes' as const })),
        ...(centerMemory.contradicts ?? []).map((id) => ({ id, relation: 'contradicts' as const })),
      ];

    const startX = centerX - ((related.length - 1) * 220) / 2;
    related.forEach((item, index) => {
      const entry = memoryById.get(item.id) ?? missingMemory(item.id);
      const above = item.relation === 'superseded by';
      const nodeY = above ? 0 : 280 + Math.floor(index / 3) * 130;
      const nodeX = above ? centerX - NODE_WIDTH / 2 : startX + index * 220 - NODE_WIDTH / 2;
      nextNodes.push({
        id: `memory:${item.id}:${index}`,
        type: 'memoryNode',
        position: { x: nodeX, y: nodeY },
        data: { entry, center: false },
      });
      const danger = item.relation === 'contradicts';
      const source = above ? `memory:${item.id}:${index}` : centerMemory.id;
      const target = above ? centerMemory.id : `memory:${item.id}:${index}`;
      nextEdges.push({
        id: `relation:${item.relation}:${item.id}:${index}`,
        source,
        target,
        type: 'smoothstep',
        animated: !danger,
        label: item.relation,
        style: {
          stroke: danger ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
          strokeWidth: 1.7,
          ...(danger ? { strokeDasharray: '5 4' } : {}),
        },
        labelStyle: {
          fill: danger ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))',
          fontSize: 9,
          fontWeight: 700,
        },
        labelBgStyle: { fill: 'hsl(var(--card))', fillOpacity: 0.9 },
      });
    });

    centerMemory.anchors.forEach((anchor, index) => {
      const id = `anchor:${index}`;
      nextNodes.push({
        id,
        type: 'anchorNode',
        position: {
          x: centerX + 220,
          y: centerY + (index - (centerMemory.anchors.length - 1) / 2) * 66,
        },
        data: { anchor, label: anchorLabel(anchor) },
      });
      nextEdges.push({
        id: `anchor-edge:${index}`,
        source: centerMemory.id,
        target: id,
        type: 'smoothstep',
        style: { stroke: 'hsl(var(--info))', strokeWidth: 1.3 },
      });
    });

    return { nodes: nextNodes, edges: nextEdges };
  }, [allMemories, centerMemory]);

  if (nodes.length <= 1) return null;

  return (
    <section
      className="overflow-hidden border border-border/75 bg-background/35"
      aria-label="Memory relationship graph"
    >
      <div className="flex items-center justify-between border-b border-border/70 bg-card/55 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Relationship map
        </p>
        <span className="font-mono text-[10px] text-muted-foreground">
          {nodes.length} nodes · {edges.length} edges
        </span>
      </div>
      <div className="h-[320px] w-full" aria-hidden="true">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.24, maxZoom: 1.05 }}
          minZoom={0.4}
          maxZoom={1.5}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnScroll={false}
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1}
            color="hsl(var(--muted-foreground) / 0.18)"
          />
          <Controls showInteractive={false} className="!border-border !bg-card !shadow-lg" />
        </ReactFlow>
      </div>
    </section>
  );
}
