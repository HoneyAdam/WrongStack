import * as fsp from 'node:fs/promises';
import { atomicWrite } from '../utils/atomic-write.js';

/**
 * Director state checkpoint — written incrementally throughout a fleet
 * run so a crashed director can be inspected (and eventually resumed)
 * instead of leaving only a final `fleet.json` manifest after `shutdown()`.
 *
 * Schema is JSON-friendly and deliberately denormalized. Each mutation
 * triggers an atomic-write of the whole file — small payloads (typically
 * < 10 KB even with dozens of subagents) make this cheap.
 */
export interface DirectorSubagentState {
  id: string;
  name?: string;
  role?: string;
  provider?: string;
  model?: string;
  spawnedAt: string;
}

export interface DirectorTaskState {
  taskId: string;
  subagentId?: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'timeout';
  assignedAt?: string;
  completedAt?: string;
  iterations?: number;
  toolCalls?: number;
  durationMs?: number;
  error?: string;
}

export interface DirectorStateSnapshot {
  version: 1;
  directorRunId: string;
  updatedAt: string;
  spawnCount: number;
  maxSpawns?: number;
  spawnDepth: number;
  maxSpawnDepth: number;
  subagents: DirectorSubagentState[];
  tasks: DirectorTaskState[];
  /** Aggregated usage snapshot. Optional — populated by the Director on save when available. */
  usage?: unknown;
}

export async function loadDirectorState(filePath: string): Promise<DirectorStateSnapshot | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as DirectorStateSnapshot;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * In-memory accumulator with atomic-write checkpoint. The Director keeps
 * an instance, mutates it on every spawn/assign/complete/fail event, and
 * the instance debounces writes so a burst of activity collapses into a
 * single disk hit.
 */
export class DirectorStateCheckpoint {
  private snapshot: DirectorStateSnapshot;
  private readonly filePath: string;
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;
  private writing = false;
  private rewriteRequested = false;

  constructor(
    filePath: string,
    init: {
      directorRunId: string;
      maxSpawns?: number;
      spawnDepth: number;
      maxSpawnDepth: number;
    },
    debounceMs = 250,
  ) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
    this.snapshot = {
      version: 1,
      directorRunId: init.directorRunId,
      updatedAt: new Date().toISOString(),
      spawnCount: 0,
      maxSpawns: init.maxSpawns,
      spawnDepth: init.spawnDepth,
      maxSpawnDepth: init.maxSpawnDepth,
      subagents: [],
      tasks: [],
    };
  }

  current(): DirectorStateSnapshot {
    return this.snapshot;
  }

  recordSpawn(sub: DirectorSubagentState, spawnCount: number): void {
    this.snapshot = {
      ...this.snapshot,
      spawnCount,
      subagents: [...this.snapshot.subagents.filter((s) => s.id !== sub.id), sub],
    };
    this.bumpUpdatedAt();
    this.schedule();
  }

  recordTaskAssigned(task: DirectorTaskState): void {
    const exists = this.snapshot.tasks.some((t) => t.taskId === task.taskId);
    this.snapshot = {
      ...this.snapshot,
      tasks: exists
        ? this.snapshot.tasks.map((t) => (t.taskId === task.taskId ? { ...t, ...task } : t))
        : [...this.snapshot.tasks, task],
    };
    this.bumpUpdatedAt();
    this.schedule();
  }

  recordTaskStatus(
    taskId: string,
    patch: Partial<DirectorTaskState> & { status: DirectorTaskState['status'] },
  ): void {
    this.snapshot = {
      ...this.snapshot,
      tasks: this.snapshot.tasks.map((t) =>
        t.taskId === taskId ? { ...t, ...patch } : t,
      ),
    };
    this.bumpUpdatedAt();
    this.schedule();
  }

  setUsage(usage: unknown): void {
    this.snapshot = { ...this.snapshot, usage };
    this.bumpUpdatedAt();
    this.schedule();
  }

  /** Force a synchronous flush — used by Director.shutdown(). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.persist();
    // If a rewrite was requested while we waited, persist() scheduled
    // a follow-up write. Wait for it so shutdown doesn't return before
    // the most recent state lands on disk.
    if (this.rewriteRequested) {
      this.rewriteRequested = false;
      await this.persist();
    }
  }

  private bumpUpdatedAt(): void {
    this.snapshot = { ...this.snapshot, updatedAt: new Date().toISOString() };
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist();
    }, this.debounceMs);
  }

  private async persist(): Promise<void> {
    if (this.writing) {
      // A write is already in flight — defer to a follow-up flush so the
      // most recent state still lands. Without this guard, simultaneous
      // burst mutations can drop the latest snapshot if rename races.
      this.rewriteRequested = true;
      return;
    }
    this.writing = true;
    try {
      await atomicWrite(this.filePath, JSON.stringify(this.snapshot, null, 2), {
        mode: 0o600,
      });
    } catch (err) {
      console.warn(
        '[director-state] checkpoint write failed:',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.writing = false;
      if (this.rewriteRequested) {
        this.rewriteRequested = false;
        this.schedule();
      }
    }
  }
}
