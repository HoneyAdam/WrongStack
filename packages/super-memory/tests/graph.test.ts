import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryGraph } from '../src/graph/graph.js';

let tmpDir: string;
let edgesLog: string;
let graph: SuperMemoryGraph;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-graph-'));
  edgesLog = path.join(tmpDir, 'edges.jsonl');
  graph = new SuperMemoryGraph(edgesLog);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SuperMemoryGraph', () => {
  it('adds an edge and returns it', async () => {
    const edge = await graph.add('node:a', 'node:b', 'related_to');
    expect(edge.from).toBe('node:a');
    expect(edge.to).toBe('node:b');
    expect(edge.relation).toBe('related_to');
    expect(edge.id).toMatch(/^edge_/);
    expect(edge.schemaVersion).toBe(1);
    expect(edge.weight).toBe(1);
    expect(edge.deletedAt).toBeUndefined();
  });

  it('does not create duplicate active edges', async () => {
    const first = await graph.add('a', 'b', 'related_to');
    const second = await graph.add('a', 'b', 'related_to');
    expect(second.id).toBe(first.id);
  });

  it('clamps weight to [0, 1]', async () => {
    const edge = await graph.add('a', 'b', 'contradicts', 5);
    expect(edge.weight).toBe(1);
    const edge2 = await graph.add('c', 'd', 'contradicts', -1);
    expect(edge2.weight).toBe(0);
  });

  it('uses default weight of 1', async () => {
    const edge = await graph.add('a', 'b', 'related_to');
    expect(edge.weight).toBe(1);
  });

  it('handles non-finite weight by returning 0', async () => {
    const edge = await graph.add('a', 'b', 'related_to', NaN);
    expect(edge.weight).toBe(0);
    const edge2 = await graph.add('c', 'd', 'related_to', Infinity);
    expect(edge2.weight).toBe(0);
  });

  it('lists edges', async () => {
    await graph.add('a', 'b', 'derived_from');
    await graph.add('c', 'd', 'validated_by');
    const edges = await graph.list();
    expect(edges).toHaveLength(2);
  });

  it('filters out deleted edges from list', async () => {
    // When an edge has a tombstone record (same id with deletedAt),
    // the list method uses the latest record which has deletedAt, so it's filtered out.
    // The original edge is effectively soft-deleted.
    const edge = await graph.add('a', 'b', 'related_to');
    await fs.writeFile(
      edgesLog,
      JSON.stringify({ ...edge, deletedAt: '2026-06-01T00:00:00.000Z' }) + '\n' +
      JSON.stringify({ schemaVersion: 1, id: 'edge_live', from: 'c', to: 'd', relation: 'related_to', weight: 1, createdAt: '' }) + '\n',
      'utf8',
    );
    const edges = await graph.list();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.id).toBe('edge_live');
  });

  it('skips malformed records', async () => {
    await fs.writeFile(edgesLog, '{"schemaVersion":1,"id":"bad","from":123}\n', 'utf8');
    await graph.add('a', 'b', 'related_to');
    const edges = await graph.list();
    expect(edges).toHaveLength(1);
  });

  it('skips records with invalid relation', async () => {
    await fs.writeFile(
      edgesLog,
      JSON.stringify({ schemaVersion: 1, id: 'bad_rel', from: 'a', to: 'b', relation: 'invalid', weight: 1 }) + '\n',
      'utf8',
    );
    await graph.add('a', 'b', 'about_file');
    const edges = await graph.list();
    expect(edges).toHaveLength(1);
  });

  it('skips records with non-finite weight', async () => {
    await fs.writeFile(
      edgesLog,
      JSON.stringify({ schemaVersion: 1, id: 'bad_w', from: 'a', to: 'b', relation: 'related_to', weight: NaN }) + '\n',
      'utf8',
    );
    await graph.add('a', 'b', 'about_file');
    const edges = await graph.list();
    expect(edges).toHaveLength(1);
  });

  it('traverses edges from start nodes', async () => {
    await graph.add('n1', 'n2', 'related_to');
    await graph.add('n2', 'n3', 'derived_from');
    await graph.add('n3', 'n4', 'about_file');

    const results = await graph.traverse(['n1'], { maxDepth: 2, limit: 10 });
    expect(results).toHaveLength(2);
    expect(results.map((e) => e.from).sort()).toContain('n1');
  });

  it('traverses with relation filter', async () => {
    await graph.add('x', 'y', 'related_to');
    await graph.add('x', 'z', 'contradicts');
    const results = await graph.traverse(['x'], { relations: ['contradicts'] });
    expect(results).toHaveLength(1);
    expect(results[0]?.relation).toBe('contradicts');
  });

  it('returns empty for empty start nodes and respects limit', async () => {
    expect(await graph.traverse([])).toEqual([]);
  });

  it('respects maxDepth bounds (0-6)', async () => {
    await graph.add('n1', 'n2', 'related_to');
    await graph.add('n2', 'n3', 'related_to');
    const results = await graph.traverse(['n1'], { maxDepth: 1 });
    expect(results).toHaveLength(1);
  });

  it('respects limit', async () => {
    await graph.add('n1', 'n2', 'related_to');
    await graph.add('n1', 'n3', 'related_to');
    const results = await graph.traverse(['n1'], { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it('handles circular references', async () => {
    await graph.add('a', 'b', 'related_to');
    await graph.add('b', 'a', 'related_to');
    const results = await graph.traverse(['a']);
    expect(results).toHaveLength(2);
  });

  it('uses custom date provider', async () => {
    const fixedDate = new Date('2025-01-01T00:00:00.000Z');
    const g = new SuperMemoryGraph(edgesLog, () => fixedDate);
    const edge = await g.add('a', 'b', 'related_to');
    expect(edge.createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('handles non-existent edges log gracefully', async () => {
    const g = new SuperMemoryGraph(path.join(tmpDir, 'nonexistent.jsonl'));
    expect(await g.list()).toEqual([]);
  });
});
