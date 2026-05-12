import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MemoryScope, MemoryStore } from '../types/memory.js';
import { atomicWrite, ensureDir } from '../utils/atomic-write.js';
import type { WstackPaths } from '../utils/wstack-paths.js';

const MAX_BYTES_TOTAL = 32_000; // ~8K tokens

export interface MemoryStoreOptions {
  paths: WstackPaths;
}

/**
 * Three scopes:
 *   project-agents → <project>/.wrongstack/AGENTS.md     (committed)
 *   project-memory → ~/.wrongstack/projects/<hash>/memory.md   (per-project agent notes)
 *   user-memory    → ~/.wrongstack/memory.md             (global personal memory)
 */
export class DefaultMemoryStore implements MemoryStore {
  private readonly files: Record<MemoryScope, string>;

  constructor(opts: MemoryStoreOptions) {
    this.files = {
      'project-agents': opts.paths.inProjectAgentsFile,
      'project-memory': opts.paths.projectMemory,
      'user-memory': opts.paths.globalMemory,
    };
  }

  async readAll(): Promise<string> {
    const parts: string[] = [];
    for (const scope of ['project-agents', 'project-memory', 'user-memory'] as MemoryScope[]) {
      const body = await this.read(scope);
      if (body.trim()) parts.push(`## ${labelOf(scope)}\n\n${body.trim()}`);
    }
    return parts.join('\n\n');
  }

  async read(scope: MemoryScope): Promise<string> {
    try {
      return await fs.readFile(this.files[scope], 'utf8');
    } catch {
      return '';
    }
  }

  async remember(text: string, scope: MemoryScope = 'project-memory'): Promise<void> {
    const file = this.files[scope];
    await ensureDir(path.dirname(file));
    let existing = '';
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch {
      // new file
    }
    const ts = new Date().toISOString();
    const entry = `\n- [${ts}] ${text.replace(/\n/g, ' ')}\n`;
    const next = existing.trim()
      ? existing.replace(/\n+$/, '') + entry
      : `# WrongStack Memory\n${entry}`;
    await atomicWrite(file, next);
    const buf = Buffer.byteLength(next, 'utf8');
    if (buf > MAX_BYTES_TOTAL) {
      await this.consolidate(scope);
    }
  }

  async forget(query: string, scope: MemoryScope = 'project-memory'): Promise<number> {
    const file = this.files[scope];
    let existing: string;
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch {
      return 0;
    }
    const needle = query.toLowerCase();
    let removed = 0;
    const lines = existing.split('\n').filter((line) => {
      if (line.trim().startsWith('- ') && line.toLowerCase().includes(needle)) {
        removed++;
        return false;
      }
      return true;
    });
    if (removed > 0) {
      await atomicWrite(file, lines.join('\n'));
    }
    return removed;
  }

  async consolidate(scope: MemoryScope): Promise<void> {
    const file = this.files[scope];
    let existing: string;
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch {
      return;
    }
    // Dedupe identical bullet lines (case-insensitive, ignoring timestamps)
    const seen = new Set<string>();
    const lines = existing.split('\n').filter((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('- ')) return true;
      const norm = trimmed.replace(/\[[^\]]+\]/, '').trim().toLowerCase();
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    });
    const next = lines.join('\n');
    // Backup AFTER successful write
    try {
      await atomicWrite(file, next);
    } catch {
      return;
    }
    // Backup only after successful write; if write fails, original is untouched
    const backup = `${file}.bak.${Date.now()}`;
    try {
      await fs.copyFile(file, backup);
    } catch {
      // backup best-effort
    }
  }
}

function labelOf(scope: MemoryScope): string {
  switch (scope) {
    case 'project-agents':
      return 'Project AGENTS.md';
    case 'project-memory':
      return 'Project memory';
    case 'user-memory':
      return 'User memory';
  }
}
