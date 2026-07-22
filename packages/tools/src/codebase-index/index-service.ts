/**
 * Execution-location-agnostic index operations.
 *
 * One implementation, two callers: the index worker thread (production —
 * synchronous SQLite and the TypeScript parser can never block the main
 * thread / terminal UI there) and the inline fallback inside the host (tests,
 * `WRONGSTACK_INDEX_INLINE=1`, or runtimes where the worker file is missing).
 *
 * Every operation opens its own short-lived IndexStore, exactly like the old
 * per-call code paths did — there is no connection state to share, which keeps
 * multi-project usage trivially correct and crash recovery simple.
 */

import type { Context } from '@wrongstack/core/agent';
import { runIndexer } from './indexer.js';
import type { CodeMapGraph, IndexResult, IndexStats, SymbolKind, SymbolLang } from './schema.js';
import type { IndexOpArgs, SearchOpArgs, SearchOpResult, StatsOpArgs } from './worker-protocol.js';
import { indexStorePool } from './writer.js';

/** A run with no live agent Context — `runIndexer` only reads `opts`. */
function stubCtx(projectRoot: string): Context {
  return {
    projectRoot,
    cwd: projectRoot,
    messages: [],
    todos: [],
    readFiles: new Set<string>(),
    fileMtimes: new Map<string, number>(),
  } as never as Context;
}

export interface ServiceHooks {
  signal?: AbortSignal | undefined;
  onProgress?: ((current: number, total: number) => void) | undefined;
}

/** Full or per-file index run. */
export async function indexService(
  args: IndexOpArgs,
  hooks: ServiceHooks = {},
): Promise<IndexResult> {
  return runIndexer(stubCtx(args.projectRoot), {
    projectRoot: args.projectRoot,
    indexDir: args.indexDir,
    files: args.files,
    force: args.force,
    langs: args.langs,
    ignore: args.ignore,
    signal: hooks.signal,
    onProgress: hooks.onProgress,
  });
}

/** Ranked symbol search (FTS5 inside SQLite; BM25 fallback without FTS5). */
export function searchService(args: SearchOpArgs): SearchOpResult {
  const store = indexStorePool.acquire(args.projectRoot, { indexDir: args.indexDir });
  try {
    return store.searchRanked(
      args.query,
      {
        kind: args.kind as SymbolKind | undefined,
        lang: args.lang as SymbolLang | undefined,
        file: args.file,
        lspKind: args.lspKind,
      },
      args.limit,
    );
  } finally {
    indexStorePool.release(store);
  }
}

/** Index health and statistics. */
export function statsService(args: StatsOpArgs): IndexStats {
  const store = indexStorePool.acquire(args.projectRoot, { indexDir: args.indexDir });
  try {
    return store.getStats();
  } finally {
    indexStorePool.release(store);
  }
}

// ─── CodeMap graph services ──────────────────────────────────────────────────

/** Package-level dependency graph. */
export function packageGraphService(args: StatsOpArgs): CodeMapGraph {
  const store = indexStorePool.acquire(args.projectRoot, { indexDir: args.indexDir });
  try {
    return store.getPackageGraph();
  } finally {
    indexStorePool.release(store);
  }
}

/** File-level dependency graph for a single package. */
export function fileGraphService(args: StatsOpArgs & { packageFilter: string }): CodeMapGraph {
  const store = indexStorePool.acquire(args.projectRoot, { indexDir: args.indexDir });
  try {
    return store.getFileGraph(args.packageFilter);
  } finally {
    indexStorePool.release(store);
  }
}

/** Symbol-level dependency graph for a single file. */
export function symbolGraphService(args: StatsOpArgs & { fileFilter: string }): CodeMapGraph {
  const store = indexStorePool.acquire(args.projectRoot, { indexDir: args.indexDir });
  try {
    return store.getSymbolGraph(args.fileFilter);
  } finally {
    indexStorePool.release(store);
  }
}
