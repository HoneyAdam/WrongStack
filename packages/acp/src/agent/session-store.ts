/**
 * ACPSessionStore — persistent session storage for the ACP server.
 *
 * Sessions are saved as JSON files in a configurable directory.
 * This enables session/load to work across server restarts.
 *
 * Format: one JSON file per session, named `<sessionId>.json`.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { SessionState } from './protocol-handler.js';

export interface SessionStoreOptions {
  /** Directory to store session files. Defaults to a temp dir. */
  dir?: string | undefined;
}

export class ACPSessionStore {
  private readonly dir: string;

  constructor(opts: SessionStoreOptions = {}) {
    this.dir = opts.dir ?? path.join(process.cwd(), '.acp-sessions');
  }

  /** Ensure the store directory exists. */
  async init(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
  }

  /** Persist a session state to disk. Returns the session id. */
  async save(state: SessionState): Promise<string> {
    await fsp.writeFile(
      path.join(this.dir, `${state.id}.json`),
      JSON.stringify(
        {
          id: state.id,
          cwd: state.cwd,
          modeId: state.modeId,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
          title: state.title,
        },
        null,
        2,
      ),
      'utf8',
    );
    return state.id;
  }

  /** Load a session state from disk. Returns null if not found. */
  async load(sessionId: string): Promise<Partial<SessionState> | null> {
    try {
      const data = await fsp.readFile(path.join(this.dir, `${sessionId}.json`), 'utf8');
      return JSON.parse(data) as Partial<SessionState>;
    } catch {
      return null;
    }
  }

  /** List all persisted sessions. */
  async list(): Promise<Array<{ id: string; updatedAt: string }>> {
    const files: string[] = [];
    try {
      const entries = await fsp.readdir(this.dir);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          files.push(entry);
        }
      }
    } catch {
      return [];
    }

    const sessions: Array<{ id: string; updatedAt: string }> = [];
    for (const file of files) {
      try {
        const data = await fsp.readFile(path.join(this.dir, file), 'utf8');
        const parsed = JSON.parse(data) as { id?: string; updatedAt?: string };
        if (parsed.id) {
          sessions.push({ id: parsed.id, updatedAt: parsed.updatedAt ?? '' });
        }
      } catch {
        // Corrupted file — skip
      }
    }
    // Sort newest-first
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sessions;
  }

  /** Delete a session file. */
  async delete(sessionId: string): Promise<void> {
    try {
      await fsp.unlink(path.join(this.dir, `${sessionId}.json`));
    } catch {
      // File may not exist — ignore
    }
  }

  /** Get the store directory path. */
  getDirectory(): string {
    return this.dir;
  }
}
