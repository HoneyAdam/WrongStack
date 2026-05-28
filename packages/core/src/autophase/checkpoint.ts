import type { PhaseGraph, PhaseNode } from './types.js';
import { PhaseStore } from './phase-store.js';

export interface Checkpoint {
  id: string;
  graphId: string;
  phaseId: string;
  phaseStatus: PhaseNode['status'];
  taskStatuses: Array<{ taskId: string; status: string; title: string }>;
  timestamp: number;
  label?: string;
}

export interface CheckpointManagerOptions {
  store: PhaseStore;
  maxCheckpoints?: number;
}

/**
 * CheckpointManager — Phase graph'ın anlık görüntülerini alır ve geri yükler.
 *
 * Kullanım:
 *   const cm = new CheckpointManager({ store });
 *   await cm.saveCheckpoint(graph, 'Before risky refactor');
 *   // ... işler ters giderse ...
 *   const restored = await cm.restoreCheckpoint(checkpointId);
 */
export class CheckpointManager {
  private store: PhaseStore;
  private maxCheckpoints: number;
  private checkpoints = new Map<string, Checkpoint>();

  constructor(opts: CheckpointManagerOptions) {
    this.store = opts.store;
    this.maxCheckpoints = opts.maxCheckpoints ?? 10;
  }

  async saveCheckpoint(graph: PhaseGraph, label?: string): Promise<Checkpoint> {
    // Önce graph'ı kaydet
    await this.store.save(graph);

    // Aktif fazdan checkpoint bilgisi çıkar
    const activePhase = Array.from(graph.phases.values()).find(
      (p) => p.status === 'running' || p.status === 'paused',
    );

    const checkpoint: Checkpoint = {
      id: crypto.randomUUID(),
      graphId: graph.id,
      phaseId: activePhase?.id ?? graph.rootPhaseIds[0] ?? '',
      phaseStatus: activePhase?.status ?? 'pending',
      taskStatuses: activePhase
        ? Array.from(activePhase.taskGraph.nodes.values()).map((t) => ({
            taskId: t.id,
            status: t.status,
            title: t.title,
          }))
        : [],
      timestamp: Date.now(),
      label,
    };

    this.checkpoints.set(checkpoint.id, checkpoint);

    // Eski checkpoint'leri temizle
    this.pruneCheckpoints();

    return checkpoint;
  }

  async restoreCheckpoint(checkpointId: string): Promise<PhaseGraph | null> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return null;

    const graph = await this.store.load(checkpoint.graphId);
    if (!graph) return null;

    // Checkpoint'teki faz status'unu geri yükle
    const phase = graph.phases.get(checkpoint.phaseId);
    if (phase) {
      phase.status = checkpoint.phaseStatus;
      phase.updatedAt = Date.now();

      // Task status'larını geri yükle
      for (const ts of checkpoint.taskStatuses) {
        const task = phase.taskGraph.nodes.get(ts.taskId);
        if (task) {
          task.status = ts.status as import('../types/task-graph.js').TaskStatus;
          task.updatedAt = Date.now();
        }
      }
    }

    graph.updatedAt = Date.now();
    return graph;
  }

  listCheckpoints(graphId?: string): Checkpoint[] {
    const all = Array.from(this.checkpoints.values());
    const filtered = graphId ? all.filter((c) => c.graphId === graphId) : all;
    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }

  deleteCheckpoint(checkpointId: string): boolean {
    return this.checkpoints.delete(checkpointId);
  }

  private pruneCheckpoints(): void {
    const all = Array.from(this.checkpoints.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    while (all.length > this.maxCheckpoints) {
      const oldest = all.shift();
      if (oldest) this.checkpoints.delete(oldest.id);
    }
  }
}
