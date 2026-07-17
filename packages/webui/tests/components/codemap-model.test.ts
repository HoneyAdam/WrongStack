import { describe, expect, it } from 'vitest';
import {
  buildDirectoryTree,
  type CodeMapGraphResponse,
  type GraphEdgeData,
  type GraphNodeData,
  layoutGraph,
} from '../../src/components/codemap-model';

function graphNode(index: number): GraphNodeData {
  return {
    id: `node:${index}`,
    label: `node-${index}`,
    kind: 'symbol',
  };
}

describe('codemap model', () => {
  it('lays out a dense graph with a linear number of edge-index reads', () => {
    const nodes = Array.from({ length: 120 }, (_, index) => graphNode(index));
    let endpointReads = 0;
    const edges: GraphEdgeData[] = [];
    for (let source = 0; source < nodes.length; source++) {
      for (let offset = 1; offset <= 4 && source + offset < nodes.length; offset++) {
        const sourceId = nodes[source]!.id;
        const targetId = nodes[source + offset]!.id;
        edges.push({
          get source() {
            endpointReads += 1;
            return sourceId;
          },
          get target() {
            endpointReads += 1;
            return targetId;
          },
          weight: offset,
          refType: 'call',
        });
      }
    }

    const positioned = layoutGraph({ nodes, edges }, 'layers');

    expect(positioned).toHaveLength(nodes.length);
    expect(new Set(positioned.map((entry) => entry.node.id)).size).toBe(nodes.length);
    expect(endpointReads).toBeLessThan(edges.length * 20);
  });

  it('keeps cyclic islands spread across multiple layers', () => {
    const nodes = Array.from({ length: 6 }, (_, index) => graphNode(index));
    const edges = nodes.map((node, index) => ({
      source: node.id,
      target: nodes[(index + 1) % nodes.length]!.id,
      weight: 1,
      refType: 'call' as const,
    }));

    const positioned = layoutGraph({ nodes, edges }, 'layers');

    expect(new Set(positioned.map((entry) => entry.position.x)).size).toBeGreaterThan(1);
    expect(new Set(positioned.map((entry) => `${entry.position.x}:${entry.position.y}`)).size).toBe(
      nodes.length,
    );
  });

  it('reuses an immutable directory tree for the same graph payload', () => {
    const nodes: CodeMapGraphResponse['nodes'] = [
      {
        id: 'file:a',
        label: 'a.ts',
        kind: 'file',
        package: '@wrongstack/core',
        file: '/workspace/packages/core/src/a.ts',
      },
      {
        id: 'file:b',
        label: 'b.ts',
        kind: 'file',
        package: '@wrongstack/core',
        file: '/workspace/packages/core/src/nested/b.ts',
      },
    ];

    const first = buildDirectoryTree(nodes);
    const second = buildDirectoryTree(nodes);

    expect(second).toBe(first);
    expect(first.directories[0]?.name).toBe('src');
    expect(first.directories[0]?.directories[0]?.name).toBe('nested');
  });
});
