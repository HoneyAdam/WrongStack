import * as path from 'node:path';

export interface FileWatcherMetrics {
  fileChangesDetected: number;
  filesProcessed: number;
  broadcastsSent: number;
  debounceResets: number;
  totalDebounceDelayMs: number;
  activeProjects: number;
  averageDebounceDelayMs: number;
  watcherActive: boolean;
}

export function statusProjectHashFromWatchFilename(
  projectsDir: string,
  filename: string | Buffer,
): string | null {
  const raw = String(filename);
  const relative = path.isAbsolute(raw) ? path.relative(projectsDir, raw) : raw;
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2 || parts.at(-1) !== 'status.json') return null;
  return parts.at(-2) ?? null;
}

export function shouldLogWatcherStats(): boolean {
  const value = process.env['WRONGSTACK_WEBUI_WATCHER_STATS']?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}
