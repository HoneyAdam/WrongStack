/**
 * `codebase-stats` tool — report index health and statistics.
 *
 * Usage: codebase-stats({})
 *
 * Returns: { totalSymbols, totalFiles, byLang, byKind, lastIndexed, sizeBytes, version }
 */

import type { Tool } from '@wrongstack/core';
import { codebaseIndexStats, getIndexState } from './background-indexer.js';
import { codebaseIndexDirOverride } from './writer.js';

export const codebaseStatsTool: Tool<Record<string, never>, CodebaseStatsOutput> = {
  name: 'codebase-stats',
  category: 'Project',
  icon: 'index',
  description:
    'Return health and statistics about the current symbol index (total symbols, files, language/kind breakdown, size, last update). Useful to decide whether to re-index.',
  usageHint:
    'CALL BEFORE HEAVY CODEBASE-SEARCH WORK:\n\n' +
    '- Use to see if the index is up-to-date or needs a refresh.\n' +
    '- No arguments required.\n' +
    '- Helps avoid wasting tokens on searches against a stale index.\n' +
    'Lightweight and safe to call frequently.',
  permission: 'auto',
  mutating: false,
  capabilities: ['fs.read'],
  timeoutMs: 5_000,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, ctx, execOpts) {
    const idxState = getIndexState();

    // Always inspect persisted state. Readiness is process-local and resets on
    // every CLI launch, while the SQLite index intentionally survives launches.
    // Fetched via the index host (worker thread when available) — the main
    // thread never opens SQLite here.
    const stats = await codebaseIndexStats(
      { projectRoot: ctx.projectRoot, indexDir: codebaseIndexDirOverride(ctx) },
      { signal: execOpts?.signal },
    );

    if (idxState.indexing) {
      return {
        ...stats,
        indexStatus: idxState.ready
          ? `Index refresh in progress (${idxState.currentFile}/${idxState.totalFiles} files). Showing the persisted snapshot.`
          : `Initial indexing in progress (${idxState.currentFile}/${idxState.totalFiles} files). Showing persisted data if available.`,
      };
    }

    const circuit = idxState.circuit;
    return {
      totalSymbols: stats.totalSymbols,
      totalFiles: stats.totalFiles,
      byLang: stats.byLang,
      byKind: stats.byKind,
      lastIndexed: stats.lastIndexed,
      sizeBytes: stats.sizeBytes,
      indexPath: stats.indexPath,
      version: stats.version,
      ...(circuit.state === 'open'
        ? {
            indexStatus:
              `Indexing is paused after repeated failures (last: ${circuit.lastFailure ?? 'unknown'}); ` +
              `auto-retry in ${Math.ceil(circuit.cooldownRemainingMs / 1000)}s, or run /codebase-reindex. Stats reflect the last successful build.`,
          }
        : {}),
    };
  },
};

interface CodebaseStatsOutput {
  totalSymbols: number;
  totalFiles: number;
  byLang: Record<string, number>;
  byKind: Record<string, number>;
  lastIndexed: number | null;
  sizeBytes: number;
  indexPath: string;
  version: number;
  /** Non-empty when the index is not ready or is still building. */
  indexStatus?: string | undefined;
}
