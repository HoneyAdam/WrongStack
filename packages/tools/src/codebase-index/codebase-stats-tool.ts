/**
 * `codebase-stats` tool — report index health and statistics.
 *
 * Usage: codebase-stats({})
 *
 * Returns: { totalSymbols, totalFiles, byLang, byKind, lastIndexed, sizeBytes, version }
 */

import type { Tool } from '@wrongstack/core';
import { IndexStore, codebaseIndexDirOverride } from './writer.js';

export const codebaseStatsTool: Tool<Record<string, never>, CodebaseStatsOutput> = {
  name: 'codebase-stats',
  category: 'Project',
  description: 'Return statistics about the symbol index: total symbols, files, breakdown by language and kind, index size, and last update time.',
  usageHint: 'No arguments needed. Use to check if the index is stale or healthy before running a search.',
  permission: 'auto',
  mutating: false,
  timeoutMs: 5_000,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, ctx) {
    const store = new IndexStore(ctx.projectRoot, { indexDir: codebaseIndexDirOverride(ctx) });
    try {
      const stats = store.getStats();
      return {
        totalSymbols: stats.totalSymbols,
        totalFiles: stats.totalFiles,
        byLang: stats.byLang,
        byKind: stats.byKind,
        lastIndexed: stats.lastIndexed,
        sizeBytes: stats.sizeBytes,
        indexPath: stats.indexPath,
        version: stats.version,
      };
    } finally {
      store.close();
    }
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
}