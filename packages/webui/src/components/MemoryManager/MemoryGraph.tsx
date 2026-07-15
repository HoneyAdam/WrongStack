/**
 * MemoryGraph — a compact React Flow graph showing relationship edges
 * (supersedes, contradicts, supersededBy) AND file/symbol/command anchor
 * connections for a selected SuperMemory entry.
 *
 * Layout:
 *   - Center: the selected memory
 *   - Above: memory that supersedes this one (if any)
 *   - Below-left: memories this one supersedes
 *   - Below-right: memories this one contradicts
 *   - Right: file/symbol/command anchors
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
  anchors?: Array<{ type: string; path?: string; symbol?: string; command?: string }>;
}

interface MemoryGraphProps {
  centerMemory: MemoryEntry;
  allMemories: MemoryEntry[];
  onSelectMemory: (id: string) => void;
}

// ── Kind emoji config ────────────────────────────────────────────────

const KIND_EMOJI: Record<string, string> = {
  fact: '📌', decision: '⚖️', convention: '📐', preference: '⭐',
  warning: '⚠️', anti_pattern: '🚫', workflow: '🔁',
  bug_root_cause: '🐛', file_note: '📄', symbol_note: '🔣',
  command_note: '⌨️', summary: '📋',
};

// ── Anchor type config ────────────────────────────────────────────────

const ANCHOR_CONFIG: Record<string, { emoji: string; border: string; bg: string; text: string }> = {
  file:      { emoji: '📄', border: 'border-blue-400', bg: 'bg-blue-50', text: 'text-blue-800' },
  directory: { emoji: '📁', border: 'border-cyan-400',  bg: 'bg-cyan-50',  text: 'text-cyan-800' },
  symbol:    { emoji: '🔣', border: 'border-purple-400', bg: 'bg-purple-50', text: 'text-purple-800' },
  package:   { emoji: '📦', border: 'border-orange-400', bg: 'bg-orange-50', text: 'text-orange-800' },
  command:   { emoji: '⌨️', border: 'border-teal-400',   bg: 'bg-teal-50',   text: 'text-teal-800' },
  test:      { emoji: '🧪', border: 'border-red-400',    bg: 'bg-red-50',    text: 'text-red-800' },
  git:       { emoji: '🔀', border: 'border-gray-400',   bg: 'bg-gray-50',   text: 'text-gray-800' },
};

// ── Node dimensions ──────────────────────────────────────────────────

const NODE_W = 200;
const ANCHOR_NODE_W = 170;

// ── Custom memory-node component ─────────────────────────────────────

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
      title={entry.text}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400" />

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

// ── Custom anchor-node component ─────────────────────────────────────

function AnchorNode({ data }: NodeProps) {
  const cfg = ANCHOR_CONFIG[data.anchorType as string] ?? ANCHOR_CONFIG['file'];
  const label = String(data.label ?? '');

  return (
    <div
      className={`rounded border-2 ${cfg.border} ${cfg.bg} px-2 py-1.5 shadow-sm`}
      style={{ width: ANCHOR_NODE_W }}
      title={label}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />
      <div className="flex items-center gap-1.5">
        <span className="text-xs">{cfg.emoji}</span>
        <span className={`truncate font-mono text-[10px] ${cfg.text}`}>{label}</span>
      </div>
    </div>
  );
}

// ── Node type registry ───────────────────────────────────────────────

const nodeTypes = {
  memoryNode: MemoryGraphNode,
  anchorNode: AnchorNode,
};

// ── Helper: build anchor ID ──────────────────────────────────────────

function anchorId(idx: number): string {
  return `anchor-${idx}`;
}

// ── Helper: edge color for anchor type ───────────────────────────────

function anchorEdgeColor(type: string): string {
  switch (type) {
    case 'file': return '#60a5fa';
    case 'directory': return '#22d3ee';
    case 'symbol': return '#a78bfa';
    case 'package': return '#fb923c';
    case 'command': return '#2dd4bf';
    case 'test': return '#f87171';
    default: return '#9ca3af';
  }
}

// ── Main component ───────────────────────────────────────────────────

export function MemoryGraph({ centerMemory, allMemories, onSelectMemory }: MemoryGraphProps) {
  // Count all visual elements
  const anchors = centerMemory.anchors ?? [];
  const totalItems =
    (centerMemory.supersedes?.length ?? 0) +
    (centerMemory.contradicts?.length ?? 0) +
    (centerMemory.supersededBy ? 1 : 0) +
    anchors.length;

  // Build nodes and edges
  const { nodes, edges } = useMemo(() => {
    const nodeList: Node[] = [];
    const edgeList: Edge[] = [];
    const CX = 260; // center x
    const RY = 100; // row height
    const SX = 200; // column spacing for sibling memory nodes
    const ANCHOR_X = CX + 210; // anchor column x

    // ── Center node ──
    nodeList.push({
      id: centerMemory.id,
      type: 'memoryNode',
      position: { x: CX - NODE_W / 2, y: RY },
      data: { entry: centerMemory, isCenter: true },
    });

    let belowCount = 0; // track how many rows below center are used

    // ── SupersededBy (above center, row 0) ──
    if (centerMemory.supersededBy) {
      const ref = allMemories.find((m) => m.id === centerMemory.supersededBy);
      const sid = centerMemory.supersededBy;
      nodeList.push({
        id: sid,
        type: 'memoryNode',
        position: { x: CX - NODE_W / 2, y: 0 },
        data: {
          entry: ref ?? { id: sid, kind: 'fact', status: 'deleted', text: '(deleted)', tags: [], createdAt: '', importance: 0, confidence: 0 },
          isCenter: false,
        },
      });
      edgeList.push({
        id: `supersededBy-${sid}`,
        source: sid, target: centerMemory.id,
        type: 'smoothstep', animated: true,
        style: { stroke: '#f59e0b', strokeWidth: 2 },
        label: 'supersedes',
        labelStyle: { fill: '#f59e0b', fontSize: 9, fontWeight: 600 },
      });
    }

    // ── Supersedes (below center, row 2) ──
    if (centerMemory.supersedes && centerMemory.supersedes.length > 0) {
      belowCount = 2;
      const list = centerMemory.supersedes;
      const startX = CX - ((list.length - 1) * SX) / 2;
      for (let i = 0; i < list.length; i++) {
        const sid = list[i]!;
        const ref = allMemories.find((m) => m.id === sid);
        nodeList.push({
          id: sid, type: 'memoryNode',
          position: { x: startX + i * SX - NODE_W / 2, y: RY * 2 },
          data: { entry: ref ?? { id: sid, kind: 'fact', status: 'deleted', text: '(not found)' as string, tags: [], createdAt: '', importance: 0, confidence: 0 }, isCenter: false },
        });
        edgeList.push({
          id: `supersedes-${sid}`, source: centerMemory.id, target: sid,
          type: 'smoothstep', animated: true,
          style: { stroke: '#22c55e', strokeWidth: 2 },
          label: 'supersedes', labelStyle: { fill: '#22c55e', fontSize: 9, fontWeight: 600 },
        });
      }
    }

    // ── Contradicts (below center, row 3, or row 2 if no supersedes) ──
    if (centerMemory.contradicts && centerMemory.contradicts.length > 0) {
      const contradictRow = belowCount === 2 ? 3 : 2;
      belowCount = Math.max(belowCount, contradictRow);
      const list = centerMemory.contradicts;
      const startX = CX - ((list.length - 1) * SX) / 2;
      for (let i = 0; i < list.length; i++) {
        const cid = list[i]!;
        const ref = allMemories.find((m) => m.id === cid);
        nodeList.push({
          id: cid, type: 'memoryNode',
          position: { x: startX + i * SX - NODE_W / 2, y: RY * contradictRow },
          data: { entry: ref ?? { id: cid, kind: 'fact', status: 'deleted', text: '(not found)' as string, tags: [], createdAt: '', importance: 0, confidence: 0 }, isCenter: false },
        });
        edgeList.push({
          id: `contradicts-${cid}`, source: centerMemory.id, target: cid,
          type: 'smoothstep',
          style: { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '6 3' },
          label: 'contradicts', labelStyle: { fill: '#ef4444', fontSize: 9, fontWeight: 600 },
        });
      }
    }

    // ── Anchor nodes (to the right of center) ──
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      const aId = anchorId(i);
      const label = a.path ?? a.symbol ?? a.command ?? a.type;
      const color = anchorEdgeColor(a.type);

      nodeList.push({
        id: aId, type: 'anchorNode',
        position: { x: ANCHOR_X, y: RY + (i - (anchors.length - 1) / 2) * 50 },
        data: { anchorType: a.type, label },
      });

      edgeList.push({
        id: `anchor-${i}`,
        source: centerMemory.id, target: aId,
        type: 'smoothstep',
        style: { stroke: color, strokeWidth: 1.5 },
        label: a.type,
        labelStyle: { fill: color, fontSize: 8, fontWeight: 600 },
      });
    }

    return { nodes: nodeList, edges: edgeList };
  }, [centerMemory, allMemories, anchors]);

  // ── Click handler ──
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Anchor nodes are not memories — clicking them does nothing
      if (node.type === 'anchorNode') return;
      if (node.id !== centerMemory.id) {
        onSelectMemory(node.id);
      }
    },
    [centerMemory.id, onSelectMemory],
  );

  if (totalItems === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <h4 className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
        🔗 Relationship Graph
      </h4>
      <div style={{ height: Math.max(220, (totalItems + 1) * 70) }} className="w-full">
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
