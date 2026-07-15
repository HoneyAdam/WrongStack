import { ulid, withFileLock } from '@wrongstack/core/utils';
import { appendJsonl, readJsonl } from '../jsonl.js';
import type { MemoryGraphEdge, MemoryGraphRelation } from '../types.js';

const VALID_RELATIONS = new Set<MemoryGraphRelation>([
  'about_file', 'about_directory', 'about_symbol', 'about_package', 'about_command',
  'derived_from', 'validated_by', 'invalidated_by', 'supersedes', 'contradicts',
  'related_to', 'same_topic',
]);

export class SuperMemoryGraph {
  constructor(
    private readonly edgesLog: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async add(
    from: string,
    to: string,
    relation: MemoryGraphRelation,
    weight = 1,
  ): Promise<MemoryGraphEdge> {
    // The append helper protects a single write, but duplicate prevention is
    // a read-then-write transaction. Coordinate that whole transaction across
    // every WrongStack surface using the same project memory.
    return withFileLock(`${this.edgesLog}.mutation`, async () => {
      const existing = (await this.list()).find(
        (edge) => !edge.deletedAt && edge.from === from && edge.to === to && edge.relation === relation,
      );
      if (existing) return existing;
      const edge: MemoryGraphEdge = {
        schemaVersion: 1,
        id: `edge_${ulid()}`,
        from,
        to,
        relation,
        weight: clamp01(weight),
        createdAt: this.now().toISOString(),
      };
      await appendJsonl(this.edgesLog, edge);
      return edge;
    }, { timeoutMs: 30_000, staleMs: 120_000 });
  }

  async list(): Promise<MemoryGraphEdge[]> {
    const records = await readJsonl<MemoryGraphEdge>(this.edgesLog);
    const latest = new Map<string, MemoryGraphEdge>();
    for (const edge of records) {
      if (
        edge?.schemaVersion === 1
        && typeof edge.id === 'string'
        && typeof edge.from === 'string'
        && typeof edge.to === 'string'
        && VALID_RELATIONS.has(edge.relation)
        && typeof edge.weight === 'number'
        && Number.isFinite(edge.weight)
      ) latest.set(edge.id, edge);
    }
    return [...latest.values()].filter((edge) => !edge.deletedAt);
  }

  /**
   * Mark every edge involving `node` as deleted by setting `deletedAt`.
   * Returns the number of edges that were actually removed (had no
   * prior `deletedAt`).
   */
  async removeNodeEdges(node: string): Promise<number> {
    return withFileLock(`${this.edgesLog}.mutation`, async () => {
      const all = await readJsonl<MemoryGraphEdge>(this.edgesLog);
      const nowIso = this.now().toISOString();
      let removed = 0;
      for (const edge of all) {
        if (
          edge?.schemaVersion === 1
          && !edge.deletedAt
          && (edge.from === node || edge.to === node)
        ) {
          edge.deletedAt = nowIso;
          removed++;
        }
      }
      if (removed > 0) {
        // Rewrite the entire log with updated edges
        const lines = all
          .filter((e): e is MemoryGraphEdge => !!e)
          .map((e) => JSON.stringify(e))
          .join('\n');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(this.edgesLog, `${lines}\n`, 'utf8');
      }
      return removed;
    }, { timeoutMs: 30_000, staleMs: 120_000 });
  }

  /**
   * Mark a single edge as deleted by its ID.
   */
  async removeEdge(edgeId: string): Promise<boolean> {
    return withFileLock(`${this.edgesLog}.mutation`, async () => {
      const all = await readJsonl<MemoryGraphEdge>(this.edgesLog);
      const nowIso = this.now().toISOString();
      let found = false;
      for (const edge of all) {
        if (edge?.id === edgeId && !edge.deletedAt) {
          edge.deletedAt = nowIso;
          found = true;
          break;
        }
      }
      if (found) {
        const lines = all
          .filter((e): e is MemoryGraphEdge => !!e)
          .map((e) => JSON.stringify(e))
          .join('\n');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(this.edgesLog, `${lines}\n`, 'utf8');
      }
      return found;
    }, { timeoutMs: 30_000, staleMs: 120_000 });
  }

  async traverse(
    starts: string[],
    opts: { maxDepth?: number; limit?: number; relations?: MemoryGraphRelation[] } = {},
  ): Promise<MemoryGraphEdge[]> {
    const edges = await this.list();
    const allowed = opts.relations ? new Set(opts.relations) : undefined;
    const maxDepth = Math.max(0, Math.min(opts.maxDepth ?? 2, 6));
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 1_000));
    const queue = starts.map((node) => ({ node, depth: 0 }));
    const visitedNodes = new Set(starts);
    const visitedEdges = new Set<string>();
    const result: MemoryGraphEdge[] = [];
    while (queue.length > 0 && result.length < limit) {
      const current = queue.shift();
      if (!current || current.depth >= maxDepth) continue;
      for (const edge of edges) {
        if (allowed && !allowed.has(edge.relation)) continue;
        const next = edge.from === current.node ? edge.to : edge.to === current.node ? edge.from : undefined;
        if (!next || visitedEdges.has(edge.id)) continue;
        visitedEdges.add(edge.id);
        result.push(edge);
        if (!visitedNodes.has(next)) {
          visitedNodes.add(next);
          queue.push({ node: next, depth: current.depth + 1 });
        }
        if (result.length >= limit) break;
      }
    }
    return result;
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
