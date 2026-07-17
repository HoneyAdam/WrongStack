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
    'Check whether a persisted codebase index exists and report its health and statistics (symbols, files, language/kind breakdown, size, last update).',
  usageHint:
    'CHECK ONCE BEFORE BROAD CODE EXPLORATION:\n\n' +
    '- Call before broad `tree`, `glob`, or `grep` exploration to see whether index-backed search is available.\n' +
    '- If it reports no persisted data, run `codebase-index`, then use `codebase-search`.\n' +
    '- No arguments required.\n' +
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
    const hasPersistedIndex = stats.totalFiles > 0 || stats.lastIndexed !== null;
    let indexStatus: string | undefined;
    if (circuit.state === 'open') {
      indexStatus =
        `${hasPersistedIndex ? 'Indexing' : 'No persisted index data found, and indexing'} is paused after repeated failures ` +
        `(last: ${circuit.lastFailure ?? 'unknown'}); auto-retry in ` +
        `${Math.ceil(circuit.cooldownRemainingMs / 1000)}s, or run /codebase-reindex. ` +
        (hasPersistedIndex
          ? 'Stats reflect the last successful build.'
          : 'Build the index after recovery.');
    } else if (!hasPersistedIndex) {
      indexStatus =
        'No persisted index data found. Run codebase-index to build it before broad code exploration.';
    }
    return {
      totalSymbols: stats.totalSymbols,
      totalFiles: stats.totalFiles,
      byLang: stats.byLang,
      byKind: stats.byKind,
      lastIndexed: stats.lastIndexed,
      sizeBytes: stats.sizeBytes,
      indexPath: stats.indexPath,
      version: stats.version,
      ...(indexStatus ? { indexStatus } : {}),
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
