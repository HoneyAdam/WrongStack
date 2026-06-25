import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWrite, ensureDir } from '../utils/atomic-write.js';
import type { SddBoardSnapshot } from './board-types.js';

export interface SddBoardStoreOptions {
  /** Directory for board snapshots + event logs (wpaths.projectSddBoards). */
  baseDir: string;
}

export interface SddBoardIndexEntry {
  runId: string;
  specId?: string | undefined;
  title: string;
  status: string;
  total: number;
  completed: number;
  updatedAt: number;
}

interface SddBoardIndex {
  version: 1;
  entries: SddBoardIndexEntry[];
}

/** One appended line in a board's JSONL event log. */
export interface SddBoardEvent {
  ts: number;
  type: string;
  payload?: unknown;
}

/**
 * File-backed SDD board storage. Each board (= one parallel run) has:
 *   - `<runId>.json`        — latest full snapshot (atomic; resume + standalone-webui mirror)
 *   - `<runId>.events.jsonl`— append-only event log (audit / replay)
 *   - `<runId>.control.jsonl` — append-only command queue (cross-process control, written by readers)
 * plus `_index.json` for fast listing. JSON for state, JSONL for streams.
 */
export class SddBoardStore {
  private readonly baseDir: string;
  private readonly indexPath: string;

  constructor(opts: SddBoardStoreOptions) {
    this.baseDir = opts.baseDir;
    this.indexPath = path.join(this.baseDir, '_index.json');
  }

  snapshotPath(runId: string): string {
    return path.join(this.baseDir, `${this.safe(runId)}.json`);
  }
  eventsPath(runId: string): string {
    return path.join(this.baseDir, `${this.safe(runId)}.events.jsonl`);
  }
  controlPath(runId: string): string {
    return path.join(this.baseDir, `${this.safe(runId)}.control.jsonl`);
  }

  async saveSnapshot(snapshot: SddBoardSnapshot): Promise<void> {
    await ensureDir(this.baseDir);
    await atomicWrite(this.snapshotPath(snapshot.runId), JSON.stringify(snapshot, null, 2), {
      mode: 0o600,
    });
    await this.updateIndex(snapshot);
  }

  async load(runId: string): Promise<SddBoardSnapshot | null> {
    try {
      const raw = await fsp.readFile(this.snapshotPath(runId), 'utf8');
      return JSON.parse(raw) as SddBoardSnapshot;
    } catch {
      return null;
    }
  }

  async list(): Promise<SddBoardIndexEntry[]> {
    const index = await this.readIndex();
    return index.entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadLatestForSpec(specId: string): Promise<SddBoardSnapshot | null> {
    const entry = (await this.list()).find((e) => e.specId === specId);
    return entry ? this.load(entry.runId) : null;
  }

  /** Append one line to the board's JSONL event log (best-effort, never throws). */
  async appendEvent(runId: string, event: SddBoardEvent): Promise<void> {
    try {
      await ensureDir(this.baseDir);
      await fsp.appendFile(this.eventsPath(runId), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    } catch {
      /* event log is best-effort */
    }
  }

  /** Append a control command (used by readers to steer a CLI-owned run). */
  async appendControl(runId: string, command: { ts: number; type: string; payload?: unknown }): Promise<void> {
    await ensureDir(this.baseDir);
    await fsp.appendFile(this.controlPath(runId), `${JSON.stringify(command)}\n`, { mode: 0o600 });
  }

  /** Read + truncate the control queue (the run drains it). Returns parsed commands. */
  async drainControl(runId: string): Promise<Array<{ ts: number; type: string; payload?: unknown }>> {
    const p = this.controlPath(runId);
    let raw: string;
    try {
      raw = await fsp.readFile(p, 'utf8');
    } catch {
      return [];
    }
    try {
      await fsp.writeFile(p, '', { mode: 0o600 });
    } catch {
      /* ignore truncate failure */
    }
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as { ts: number; type: string; payload?: unknown };
        } catch {
          return null;
        }
      })
      .filter((c): c is { ts: number; type: string; payload?: unknown } => c !== null);
  }

  async delete(runId: string): Promise<void> {
    await Promise.allSettled([
      fsp.unlink(this.snapshotPath(runId)),
      fsp.unlink(this.eventsPath(runId)),
      fsp.unlink(this.controlPath(runId)),
    ]);
    await this.removeFromIndex(runId);
  }

  // ── internal ────────────────────────────────────────────────────────────

  private safe(runId: string): string {
    return runId.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private async readIndex(): Promise<SddBoardIndex> {
    try {
      const raw = await fsp.readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as SddBoardIndex;
      if (parsed?.version === 1) return parsed;
    } catch {
      /* no index yet */
    }
    return { version: 1, entries: [] };
  }

  private async updateIndex(snapshot: SddBoardSnapshot): Promise<void> {
    const index = await this.readIndex();
    const entry: SddBoardIndexEntry = {
      runId: snapshot.runId,
      specId: snapshot.specId,
      title: snapshot.title,
      status: snapshot.status,
      total: snapshot.progress.total,
      completed: snapshot.progress.completed,
      updatedAt: snapshot.updatedAt,
    };
    const idx = index.entries.findIndex((e) => e.runId === snapshot.runId);
    if (idx >= 0) index.entries[idx] = entry;
    else index.entries.push(entry);
    await atomicWrite(this.indexPath, JSON.stringify(index, null, 2), { mode: 0o600 });
  }

  private async removeFromIndex(runId: string): Promise<void> {
    const index = await this.readIndex();
    index.entries = index.entries.filter((e) => e.runId !== runId);
    await atomicWrite(this.indexPath, JSON.stringify(index, null, 2), { mode: 0o600 });
  }
}
