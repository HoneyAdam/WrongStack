/**
 * MemoryGraph — a compact React Flow graph showing relationship edges
 * (supersedes, contradicts, supersededBy) for a selected SuperMemory entry.
 *
 * Layout: center node with supersedes/contradicts below and supersededBy above.
 * Each node is clickable to navigate to that memory.
 */
import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ── Types ────────────────────────────────────────────────────────────

interface MemoryEntry {
  id: string;
  kind: string;
  status: string;
  text: string;
  tags: string[];
  createdAt: string;
  importance: number;
  confidence: number;
  supersedes?: string[] | undefined;
  supersededBy?: string | undefined;
  contradicts?: string[] | undefined;
}

interface MemoryGraphProps {
  centerMemory: MemoryEntry;
  allMemories: MemoryEntry[];
  onSelectMemory: (id: string) => void;
}

// ── Kind emoji config ────────────────────────────────────────────────

const KIND_EMOJI: Record<string, string> = {
  fact: '📌',
  decision: '⚖️',
  convention: '📐',
  preference: '⭐',
  warning: '⚠️',
  anti_pattern: '🚫',
  workflow: '🔁',
  bug_root_cause: '🐛',
  file_note: '📄',
  symbol_note: '🔣',
  command_note: '⌨️',
  summary: '📋',
};

// ── Custom node component ────────────────────────────────────────────

const NODE_W = 200;
const NODE_H = 64;

function MemoryGraphNode({ data }: NodeProps) {
  const entry = data.entry as MemoryEntry;
  const preview = entry.text.length > 40 ? `${entry.text.slice(0, 38)}…` : entry.text;
  const kindEmoji = KIND_EMOJI[entry.kind] ?? '•';
  const statusColor =
    entry.status === 'active' ? 'bg-green-100 text-green-800 border-green-300'
    : entry.status === 'stale' ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
    : entry.status === 'archived' ? 'bg-blue-100 text-blue-800 border-blue-300'
    : entry.status === 'deleted' ? 'bg-gray-100 text-gray-500 border-gray-300'
    : 'bg-gray-50 text-gray-600 border-gray-200';

  return (
    <div
      className={`rounded-lg border-2 bg-white px-3 py-2 shadow-sm transition-shadow hover:shadow-md ${
        data.isCenter ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'
      }`}
      style={{ width: NODE_W }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />

      <div className="flex items-center gap-1.5">
        <span className="text-sm">{kindEmoji}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColor}`}>
          {entry.status}
        </span>
        <span className="ml-auto font-mono text-[9px] text-gray-400">
          {entry.id.length > 12 ? `${entry.id.slice(0, 10)}…` : entry.id}
        </span>
      </div>

      <p className="mt-1 text-xs leading-4 text-gray-700 line-clamp-2">{preview}</p>
    </div>
  );
}

const nodeTypes = { memoryNode: MemoryGraphNode };

// ── Main component ───────────────────────────────────────────────────

export function MemoryGraph({ centerMemory, allMemories, onSelectMemory }: MemoryGraphProps) {
  // Track total connections
  const totalEdges =
    (centerMemory.supersedes?.length ?? 0) +
    (centerMemory.contradicts?.length ?? 0) +
    (centerMemory.supersededBy ? 1 : 0);

  // Build nodes and edges
  const { nodes, edges } = useMemo(() => {
    const nodeList: Node[] = [];
    const edgeList: Edge[] = [];
    const CX = 300; // center x
    const SPACING_Y = 110;
    const SPACING_X = 220;

    // ── Center node ──
    const centerNode: Node = {
      id: centerMemory.id,
      type: 'memoryNode',
      position: { x: CX - NODE_W / 2, y: SPACING_Y },
      data: { entry: centerMemory, isCenter: true },
    };
    nodeList.push(centerNode);

    // ── SupersededBy (above center) ──
    if (centerMemory.supersededBy) {
      const ref = allMemories.find((m) => m.id === centerMemory.supersededBy);
      if (ref) {
        const sid = centerMemory.supersededBy;
        nodeList.push({
          id: sid,
          type: 'memoryNode',
          position: { x: CX - NODE_W / 2, y: 0 },
          data: { entry: ref, isCenter: false },
        });
        edgeList.push({
          id: `supersededBy-${sid}`,
          source: sid,
          target: centerMemory.id,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#f59e0b', strokeWidth: 2 },
          label: 'supersedes',
          labelStyle: { fill: '#f59e0b', fontSize: 9, fontWeight: 600 },
        });
      } else {
        // Reference exists but memory not in loaded list
        nodeList.push({
          id: centerMemory.supersededBy,
          type: 'memoryNode',
          position: { x: CX - NODE_W / 2, y: 0 },
          data: { entry: { id: centerMemory.supersededBy, kind: 'fact', status: 'deleted', text: '(deleted)', tags: [], createdAt: '', importance: 0, confidence: 0, supersedes: [], supersededBy: undefined, contradicts: [] }, isCenter: false },
        });
        edgeList.push({
          id: `supersededBy-${centerMemory.supersededBy}`,
          source: centerMemory.supersededBy,
          target: centerMemory.id,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '4 2' },
          label: 'supersedes',
          labelStyle: { fill: '#f59e0b', fontSize: 9, fontWeight: 600 },
        });
      }
    }

    // ── Supersedes (below center) ──
    if (centerMemory.supersedes) {
      for (let i = 0; i < centerMemory.supersedes.length; i++) {
        const sid = centerMemory.supersedes[i]!;
        const ref = allMemories.find((m) => m.id === sid);
        const offsetX = (i - (centerMemory.supersedes.length - 1) / 2) * SPACING_X;
        nodeList.push({
          id: sid,
          type: 'memoryNode',
          position: { x: CX + offsetX - NODE_W / 2, y: SPACING_Y * 2 },
          data: {
            entry: ref ?? { id: sid, kind: 'fact', status: 'deleted', text: '(not in loaded list)', tags: [], createdAt: '', importance: 0, confidence: 0, supersedes: [], supersededBy: undefined, contradicts: [] },
            isCenter: false,
          },
        });
        edgeList.push({
          id: `supersedes-${sid}`,
          source: centerMemory.id,
          target: sid,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#22c55e', strokeWidth: 2 },
          label: 'supersedes',
          labelStyle: { fill: '#22c55e', fontSize: 9, fontWeight: 600 },
        });
      }
    }

    // ── Contradicts (below center, offset right) ──
    if (centerMemory.contradicts) {
      for (let i = 0; i < centerMemory.contradicts.length; i++) {
        const cid = centerMemory.contradicts[i]!;
        const ref = allMemories.find((m) => m.id === cid);
        const offsetX = (i - (centerMemory.contradicts.length - 1) / 2) * SPACING_X;
        nodeList.push({
          id: cid,
          type: 'memoryNode',
          position: { x: CX + offsetX - NODE_W / 2, y: SPACING_Y * 3 },
          data: {
            entry: ref ?? { id: cid, kind: 'fact', status: 'deleted', text: '(not in loaded list)', tags: [], createdAt: '', importance: 0, confidence: 0, supersedes: [], supersededBy: undefined, contradicts: [] },
            isCenter: false,
          },
        });
        edgeList.push({
          id: `contradicts-${cid}`,
          source: centerMemory.id,
          target: cid,
          type: 'smoothstep',
          style: { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '6 3' },
          label: 'contradicts',
          labelStyle: { fill: '#ef4444', fontSize: 9, fontWeight: 600 },
        });
      }
    }

    return { nodes: nodeList, edges: edgeList };
  }, [centerMemory, allMemories]);

  // ── Click handler ──
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id !== centerMemory.id) {
        onSelectMemory(node.id);
      }
    },
    [centerMemory.id, onSelectMemory],
  );

  if (totalEdges === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <h4 className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
        🔗 Relationship Graph
      </h4>
      <div style={{ height: Math.max(200, (totalEdges + 1) * 100) }} className="w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={true}
          zoomOnScroll={false}
          minZoom={0.5}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e5e7eb" />
          <Controls showInteractive={false} className="!m-2 !scale-75" />
        </ReactFlow>
      </div>
    </div>
  );
}
